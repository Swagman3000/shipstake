import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, describe, it } from "node:test";
import { BN, Program } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from "@solana/web3.js";
import { address, getTransactionDecoder } from "@solana/kit";
import { FailedTransactionMetadata, LiteSVM } from "litesvm";

const idl = JSON.parse(readFileSync("target/idl/shipstake.json", "utf8"));
const HOUR = 3600;
const DAY = 24 * HOUR;
const START = 1_800_000_000;
const SOL = LAMPORTS_PER_SOL;

let svm: LiteSVM;
let program: Program<any>;
let payer: Keypair, team: Keypair, reviewer: Keypair, alice: Keypair, bob: Keypair, stranger: Keypair;

const u64le = (n: number) => new BN(n).toArrayLike(Buffer, "le", 8);
const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
const profilePda = () => pda(Buffer.from("team"), team.publicKey.toBuffer());
const promisePda = (id = 0) => pda(Buffer.from("promise"), team.publicKey.toBuffer(), u64le(id));
const backingPda = (who: Keypair, id = 0) =>
  pda(Buffer.from("backing"), promisePda(id).toBuffer(), who.publicKey.toBuffer());

const balance = async (k: PublicKey) => Number(svm.getBalance(address(k.toBase58())) ?? 0n);
const promise = () => (program.account as any).promiseAccount.fetch(promisePda());
const profile = () => (program.account as any).teamProfile.fetch(profilePda());
const statusOf = async () => Object.keys((await promise()).status)[0];

async function warp(unix: number) {
  const clock = svm.getClock();
  clock.unixTimestamp = BigInt(unix);
  svm.setClock(clock);
}

// The small part of an Anchor provider these tests need, backed by LiteSVM.
function provider() {
  const read = (key: PublicKey) => {
    const a = svm.getAccount(address(key.toBase58()));
    if (!a.exists) return null;
    return {
      data: Buffer.from(a.data),
      lamports: Number(a.lamports),
      owner: new PublicKey(a.programAddress),
      executable: a.executable,
      rentEpoch: 0,
    };
  };
  return {
    publicKey: payer.publicKey,
    wallet: { publicKey: payer.publicKey, payer },
    connection: {
      getAccountInfo: async (key: PublicKey) => read(key),
      getAccountInfoAndContext: async (key: PublicKey) => ({ context: { slot: 0 }, value: read(key) }),
    },
    sendAndConfirm: async (tx: Transaction, signers: Keypair[] = []) => {
      svm.expireBlockhash();
      tx.feePayer = payer.publicKey;
      tx.recentBlockhash = svm.latestBlockhash();
      tx.sign(payer, ...signers);
      const result = svm.sendTransaction(getTransactionDecoder().decode(tx.serialize()) as any);
      if (result instanceof FailedTransactionMetadata) {
        throw new Error(`${result.toString()}\n${result.meta().logs().join("\n")}`);
      }
      return "ok";
    },
  };
}

async function rejects(action: Promise<unknown>, errorName: string) {
  const entry = idl.errors.find((e: any) => e.name === errorName);
  assert.ok(entry, `unknown error ${errorName}`);
  const hex = `0x${entry.code.toString(16)}`;
  await assert.rejects(action, (e: any) => {
    const text = `${e?.message} ${e?.logs?.join(" ") ?? ""} ${e?.error?.errorCode?.code ?? ""}`;
    return text.includes(hex) || text.toLowerCase().includes(errorName.toLowerCase());
  });
}

const create = (stake = 10 * SOL, deadline = START + 30 * DAY, by = team, rev = reviewer.publicKey) =>
  program.methods
    .createPromise(new BN(0), "Tidepool", "Mobile app in public beta", "Listed on TestFlight", new BN(stake), new BN(deadline), rev)
    .accountsPartial({ team: by.publicKey, profile: profilePda(), promise: promisePda() })
    .signers([by])
    .rpc();

const back = (who: Keypair, amount: number) =>
  program.methods
    .back(new BN(amount))
    .accountsPartial({ backer: who.publicKey, promise: promisePda(), backing: backingPda(who) })
    .signers([who])
    .rpc();

const proof = (by = team) =>
  program.methods
    .postProof("https://example.com/release")
    .accountsPartial({ team: by.publicKey, promise: promisePda() })
    .signers([by])
    .rpc();

const challenge = (who: Keypair) =>
  program.methods
    .challenge()
    .accountsPartial({ backer: who.publicKey, promise: promisePda(), backing: backingPda(who) })
    .signers([who])
    .rpc();

const rule = (shipped: boolean, by = reviewer) =>
  program.methods
    .rule(shipped)
    .accountsPartial({ reviewer: by.publicKey, promise: promisePda(), profile: profilePda() })
    .signers([by])
    .rpc();

const finalize = () =>
  program.methods.finalize().accountsPartial({ promise: promisePda(), profile: profilePda() }).rpc();

const withdraw = (by = team) =>
  program.methods
    .withdrawStake()
    .accountsPartial({ team: by.publicKey, promise: promisePda() })
    .signers([by])
    .rpc();

const claim = (who: Keypair) =>
  program.methods
    .claimBacking()
    .accountsPartial({ backer: who.publicKey, promise: promisePda(), backing: backingPda(who) })
    .signers([who])
    .rpc();

beforeEach(async () => {
  [payer, team, reviewer, alice, bob, stranger] = Array.from({ length: 6 }, () => Keypair.generate());
  svm = new LiteSVM();
  svm.addProgramFromFile(address(idl.address), "target/deploy/shipstake.so");
  for (const k of [payer, team, reviewer, alice, bob, stranger]) {
    svm.airdrop(address(k.publicKey.toBase58()), BigInt(1000 * SOL) as any);
  }
  program = new Program(idl, provider() as any);
  await warp(START);
});

describe("delivery", () => {
  it("returns the stake and deposits when an unchallenged proof stands", async () => {
    await create();
    await back(alice, 2 * SOL);
    await warp(START + 20 * DAY);
    await proof();
    await warp(START + 20 * DAY + 72 * HOUR + 1);
    await finalize();
    assert.equal(await statusOf(), "shipped");

    const teamBefore = await balance(team.publicKey);
    await withdraw();
    assert.equal((await balance(team.publicKey)) - teamBefore > 9.99 * SOL, true);

    const aliceBefore = await balance(alice.publicKey);
    await claim(alice);
    const gained = (await balance(alice.publicKey)) - aliceBefore;
    assert.ok(gained >= 2 * SOL && gained < 2.01 * SOL, `alice gained ${gained}`);

    const p = await profile();
    assert.equal(p.shippedCount.toNumber(), 1);
    assert.equal(p.missedCount.toNumber(), 0);
  });
});

describe("miss", () => {
  it("splits the stake by amount backed when no proof arrives", async () => {
    await create();
    await back(alice, 3 * SOL);
    await back(bob, 1 * SOL);
    await warp(START + 30 * DAY + 1);
    await finalize();
    assert.equal(await statusOf(), "missed");

    const a0 = await balance(alice.publicKey);
    const b0 = await balance(bob.publicKey);
    await claim(alice);
    await claim(bob);
    const aGain = (await balance(alice.publicKey)) - a0;
    const bGain = (await balance(bob.publicKey)) - b0;
    assert.ok(aGain >= 10.5 * SOL && aGain < 10.51 * SOL, `alice gained ${aGain}`);
    assert.ok(bGain >= 3.5 * SOL && bGain < 3.51 * SOL, `bob gained ${bGain}`);

    const p = await profile();
    assert.equal(p.missedCount.toNumber(), 1);
    assert.equal(p.totalLost.toNumber(), 10 * SOL);
  });

  it("blocks the team from withdrawing a stake owed to backers", async () => {
    await create();
    await back(alice, SOL);
    await warp(START + 30 * DAY + 1);
    await finalize();
    await rejects(withdraw(), "WrongStatus");
  });

  it("refunds the team when a missed promise has no backers", async () => {
    await create();
    await warp(START + 30 * DAY + 1);
    await finalize();
    const before = await balance(team.publicKey);
    await withdraw();
    assert.ok((await balance(team.publicKey)) - before > 9.99 * SOL);
    assert.equal((await profile()).totalLost.toNumber(), 0);
  });
});

describe("backing rules", () => {
  it("closes backing halfway to the deadline", async () => {
    await create();
    await warp(START + 15 * DAY + 1);
    await rejects(back(alice, SOL), "BackingClosed");
  });

  it("adds repeat deposits without counting the backer twice", async () => {
    await create();
    await back(alice, SOL);
    await back(alice, 2 * SOL);
    const p = await promise();
    assert.equal(p.backerCount, 1);
    assert.equal(p.totalBacked.toNumber(), 3 * SOL);
  });

  it("rejects the team and the reviewer as backers", async () => {
    await create();
    await rejects(back(team, SOL), "TeamCannotBack");
    await rejects(back(reviewer, SOL), "ReviewerCannotBack");
  });

  it("holds deposits until the promise settles", async () => {
    await create();
    await back(alice, SOL);
    await rejects(claim(alice), "WrongStatus");
  });
});

describe("challenges", () => {
  beforeEach(async () => {
    await create();
    await back(alice, SOL);
    await warp(START + 20 * DAY);
    await proof();
  });

  it("pays backers when the reviewer rejects the proof", async () => {
    await challenge(alice);
    await rule(false);
    assert.equal(await statusOf(), "missed");
    await rejects(withdraw(), "WrongStatus");
  });

  it("returns the stake when the reviewer upholds the proof", async () => {
    await challenge(alice);
    await rule(true);
    assert.equal(await statusOf(), "shipped");
    await withdraw();
  });

  it("counts a silent reviewer against the team", async () => {
    await challenge(alice);
    await warp(START + 20 * DAY + 8 * DAY);
    await rejects(rule(true), "ReviewClosed");
    await finalize();
    assert.equal(await statusOf(), "missed");
  });

  it("only lets backers challenge, and only inside the window", async () => {
    await assert.rejects(challenge(stranger));
    await warp(START + 20 * DAY + 72 * HOUR + 1);
    await rejects(challenge(alice), "ChallengeClosed");
  });

  it("only lets the named reviewer rule", async () => {
    await challenge(alice);
    await assert.rejects(rule(true, stranger));
    await assert.rejects(rule(true, team));
  });

  it("blocks settling while a challenge or window is open", async () => {
    await rejects(finalize(), "TooEarly");
    await challenge(alice);
    await rejects(finalize(), "TooEarly");
  });
});

describe("guards", () => {
  it("rejects a promise the team would review itself", async () => {
    await rejects(create(10 * SOL, START + 30 * DAY, team, team.publicKey), "TeamCannotReview");
  });

  it("rejects stakes and deadlines outside the limits", async () => {
    await rejects(create(1000), "StakeTooSmall");
    await rejects(create(10 * SOL, START + HOUR), "DeadlineTooSoon");
    await rejects(create(10 * SOL, START + 400 * DAY), "DeadlineTooFar");
  });

  it("rejects proof after the deadline and from anyone but the team", async () => {
    await create();
    await assert.rejects(proof(stranger));
    await warp(START + 30 * DAY + 1);
    await rejects(proof(), "DeadlinePassed");
  });

  it("can't be settled before the deadline", async () => {
    await create();
    await rejects(finalize(), "TooEarly");
  });

  it("can't pay out twice", async () => {
    await create();
    await back(alice, SOL);
    await warp(START + 20 * DAY);
    await proof();
    await warp(START + 24 * DAY);
    await finalize();
    await withdraw();
    await warp(START + 24 * DAY + 1);
    await rejects(withdraw(), "AlreadyWithdrawn");
    await claim(alice);
    await assert.rejects(claim(alice));
    await rejects(finalize(), "WrongStatus");
  });

  it("stops other wallets withdrawing the stake", async () => {
    await create();
    await warp(START + 30 * DAY + 1);
    await finalize();
    await assert.rejects(withdraw(stranger));
  });

  it("keeps the promise on-chain after every payout", async () => {
    await create();
    await back(alice, SOL);
    await warp(START + 30 * DAY + 1);
    await finalize();
    await claim(alice);
    assert.equal(await statusOf(), "missed");
    assert.ok((await balance(promisePda())) > 0);
  });
});
