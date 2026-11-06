// Confirms the deployed devnet program runs with real timers. It only simulates,
// so nothing is written on-chain.
import { readFileSync } from "node:fs";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const idl = JSON.parse(readFileSync("target/idl/shipstake.json", "utf8"));
const key = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(".keys/devnet-deployer.json", "utf8"))));
const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const program = new Program(idl, new AnchorProvider(connection, new Wallet(key), { commitment: "confirmed" }));

const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, program.programId)[0];
const profile = pda(Buffer.from("team"), key.publicKey.toBuffer());
const promise = pda(Buffer.from("promise"), key.publicKey.toBuffer(), new BN(0).toArrayLike(Buffer, "le", 8));

const simulate = (secondsAway: number) =>
  program.methods
    .createPromise(new BN(0), "Check", "Simulated only", "None", new BN(10_000_000), new BN(Math.floor(Date.now() / 1000) + secondsAway), Keypair.generate().publicKey)
    .accountsPartial({ team: key.publicKey, profile, promise })
    .simulate();

async function main() {
  const ok = await simulate(2 * 86400);
  console.log("Valid promise simulated:", ok.raw[ok.raw.length - 1]);

  try {
    await simulate(120);
    throw new Error("A 2-minute deadline was accepted, so the fast timers are live");
  } catch (e: any) {
    const logs: string[] = e.simulationResponse?.logs ?? e.logs ?? [];
    if (!logs.some((l) => l.includes("DeadlineTooSoon"))) throw e;
    console.log("2-minute deadline rejected: real timers are live");
  }

  console.log("Promises on devnet:", (await (program.account as any).promiseAccount.all()).length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
