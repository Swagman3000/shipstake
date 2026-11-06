// Runs every path of a promise against a live RPC node, with real transactions and
// real timers. Needs the devnet-fast build. Usage: RPC_URL=http://127.0.0.1:8899 npm run flow
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL as SOL, PublicKey } from "@solana/web3.js";

const RPC_URL = process.env.RPC_URL ?? "http://127.0.0.1:8899";
if (RPC_URL.includes("mainnet")) throw new Error("This script must never run against mainnet");

const idl = JSON.parse(readFileSync("target/idl/shipstake.json", "utf8"));
const connection = new Connection(RPC_URL, "confirmed");
const id = new PublicKey(idl.address);
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));
const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, id)[0];

const as = (k: Keypair) => new Program(idl, new AnchorProvider(connection, new Wallet(k), { commitment: "confirmed" }));

async function fund(k: Keypair, sol: number) {
  const sig = await connection.requestAirdrop(k.publicKey, sol * SOL);
  await connection.confirmTransaction(sig, "confirmed");
}

async function setup(title: string, seconds: number) {
  const [team, reviewer, backer] = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  await Promise.all([fund(team, 20), fund(reviewer, 1), fund(backer, 20)]);
  const profile = pda(Buffer.from("team"), team.publicKey.toBuffer());
  const promise = pda(Buffer.from("promise"), team.publicKey.toBuffer(), new BN(0).toArrayLike(Buffer, "le", 8));
  const backing = pda(Buffer.from("backing"), promise.toBuffer(), backer.publicKey.toBuffer());
  const deadline = Math.floor(Date.now() / 1000) + seconds;
  await as(team).methods
    .createPromise(new BN(0), "Flow test", title, "A public link", new BN(5 * SOL), new BN(deadline), reviewer.publicKey)
    .accountsPartial({ team: team.publicKey, profile, promise }).rpc();
  await as(backer).methods.back(new BN(2 * SOL)).accountsPartial({ backer: backer.publicKey, promise, backing }).rpc();
  const status = async () => Object.keys((await (as(team).account as any).promiseAccount.fetch(promise)).status)[0];
  const finalize = () => as(team).methods.finalize().accountsPartial({ promise, profile }).rpc();
  return { team, reviewer, backer, profile, promise, backing, status, finalize };
}

const proof = (f: Awaited<ReturnType<typeof setup>>) =>
  as(f.team).methods.postProof("https://example.com/proof").accountsPartial({ team: f.team.publicKey, promise: f.promise }).rpc();
const challenge = (f: Awaited<ReturnType<typeof setup>>) =>
  as(f.backer).methods.challenge().accountsPartial({ backer: f.backer.publicKey, promise: f.promise, backing: f.backing }).rpc();
const claim = (f: Awaited<ReturnType<typeof setup>>) =>
  as(f.backer).methods.claimBacking().accountsPartial({ backer: f.backer.publicKey, promise: f.promise, backing: f.backing }).rpc();

async function main() {
  const [shipped, ruled, missed] = await Promise.all([
    setup("Unchallenged proof", 90),
    setup("Reviewer rejects proof", 90),
    setup("No proof", 62),
  ]);
  console.log("created 3 promises and backed each");

  await proof(shipped);
  await proof(ruled);
  await challenge(ruled);
  await as(ruled.reviewer).methods.rule(false)
    .accountsPartial({ reviewer: ruled.reviewer.publicKey, promise: ruled.promise, profile: ruled.profile }).rpc();
  assert.equal(await ruled.status(), "missed");
  const before = await connection.getBalance(ruled.backer.publicKey);
  await claim(ruled);
  const gained = (await connection.getBalance(ruled.backer.publicKey)) - before;
  assert.ok(gained >= 7 * SOL, `backer gained ${gained / SOL} SOL`);
  console.log(`reviewer rejected proof: backer received ${gained / SOL} SOL`);

  await sleep(66);
  await missed.finalize();
  assert.equal(await missed.status(), "missed");
  await claim(missed);
  console.log("no proof by the deadline: settled as missed and paid out");

  await sleep(60);
  await shipped.finalize();
  assert.equal(await shipped.status(), "shipped");
  const teamBefore = await connection.getBalance(shipped.team.publicKey);
  await as(shipped.team).methods.withdrawStake().accountsPartial({ team: shipped.team.publicKey, promise: shipped.promise }).rpc();
  assert.ok((await connection.getBalance(shipped.team.publicKey)) - teamBefore > 4.99 * SOL);
  await claim(shipped);
  console.log("unchallenged proof: settled as shipped, stake and deposit returned");
  console.log("ALL FLOWS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
