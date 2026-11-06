import { AnchorProvider, BN, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import idl from "./idl/shipstake.json";

export const RPC_URL = import.meta.env.VITE_RPC_URL ?? "https://api.devnet.solana.com";
export const NETWORK = import.meta.env.VITE_NETWORK ?? "devnet";
export const PROGRAM_ID = new PublicKey(idl.address);

export type Status = "active" | "proofPosted" | "challenged" | "shipped" | "missed";

export interface PromiseData {
  address: PublicKey;
  team: PublicKey;
  reviewer: PublicKey;
  id: number;
  title: string;
  criteria: string;
  proofUri: string;
  stake: number;
  totalBacked: number;
  backerCount: number;
  createdAt: number;
  backingClosesAt: number;
  deadline: number;
  proofAt: number;
  challengeEndsAt: number;
  reviewEndsAt: number;
  challenger: PublicKey;
  status: Status;
  stakeWithdrawn: boolean;
}

export interface TeamData {
  team: PublicKey;
  name: string;
  promiseCount: number;
  shippedCount: number;
  missedCount: number;
  totalStaked: number;
  totalLost: number;
}

export interface BackingData {
  address: PublicKey;
  backer: PublicKey;
  amount: number;
}

// Reading accounts needs no signature, so visitors without a wallet use a throwaway one.
const readOnlyWallet = (): AnchorWallet => ({
  publicKey: Keypair.generate().publicKey,
  signTransaction: () => Promise.reject(new Error("Connect a wallet first")),
  signAllTransactions: () => Promise.reject(new Error("Connect a wallet first")),
});

export function getProgram(connection: Connection, wallet?: AnchorWallet): Program<any> {
  const provider = new AnchorProvider(connection, wallet ?? readOnlyWallet(), { commitment: "confirmed" });
  return new Program(idl as any, provider);
}

const pda = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
export const teamPda = (team: PublicKey) => pda(Buffer.from("team"), team.toBuffer());
export const promisePda = (team: PublicKey, id: number) =>
  pda(Buffer.from("promise"), team.toBuffer(), new BN(id).toArrayLike(Buffer, "le", 8));
export const backingPda = (promise: PublicKey, backer: PublicKey) =>
  pda(Buffer.from("backing"), promise.toBuffer(), backer.toBuffer());

const n = (v: BN) => v.toNumber();

function toPromise(address: PublicKey, a: any): PromiseData {
  return {
    address,
    team: a.team,
    reviewer: a.reviewer,
    id: n(a.id),
    title: a.title,
    criteria: a.criteria,
    proofUri: a.proofUri,
    stake: n(a.stake),
    totalBacked: n(a.totalBacked),
    backerCount: a.backerCount,
    createdAt: n(a.createdAt),
    backingClosesAt: n(a.backingClosesAt),
    deadline: n(a.deadline),
    proofAt: n(a.proofAt),
    challengeEndsAt: n(a.challengeEndsAt),
    reviewEndsAt: n(a.reviewEndsAt),
    challenger: a.challenger,
    status: Object.keys(a.status)[0] as Status,
    stakeWithdrawn: a.stakeWithdrawn,
  };
}

function toTeam(a: any): TeamData {
  return {
    team: a.team,
    name: a.name,
    promiseCount: n(a.promiseCount),
    shippedCount: n(a.shippedCount),
    missedCount: n(a.missedCount),
    totalStaked: n(a.totalStaked),
    totalLost: n(a.totalLost),
  };
}

const accounts = (program: Program<any>) => program.account as any;

export async function fetchPromises(program: Program<any>): Promise<PromiseData[]> {
  const rows = await accounts(program).promiseAccount.all();
  return rows.map((r: any) => toPromise(r.publicKey, r.account)).sort((a: PromiseData, b: PromiseData) => b.createdAt - a.createdAt);
}

export async function fetchPromise(program: Program<any>, address: PublicKey): Promise<PromiseData | null> {
  const a = await accounts(program).promiseAccount.fetchNullable(address);
  return a ? toPromise(address, a) : null;
}

export async function fetchTeams(program: Program<any>): Promise<Map<string, TeamData>> {
  const rows = await accounts(program).teamProfile.all();
  return new Map(rows.map((r: any) => [r.account.team.toBase58(), toTeam(r.account)]));
}

export async function fetchTeam(program: Program<any>, team: PublicKey): Promise<TeamData | null> {
  const a = await accounts(program).teamProfile.fetchNullable(teamPda(team));
  return a ? toTeam(a) : null;
}

// The promise address is the first field after the 8-byte account prefix.
export async function fetchBackings(program: Program<any>, promise: PublicKey): Promise<BackingData[]> {
  const rows = await accounts(program).backing.all([{ memcmp: { offset: 8, bytes: promise.toBase58() } }]);
  return rows
    .map((r: any) => ({ address: r.publicKey, backer: r.account.backer, amount: n(r.account.amount) }))
    .sort((a: BackingData, b: BackingData) => b.amount - a.amount);
}

export const toLamports = (sol: number) => new BN(Math.round(sol * LAMPORTS_PER_SOL));
export const sol = (lamports: number) =>
  (lamports / LAMPORTS_PER_SOL).toLocaleString("en-US", { maximumFractionDigits: 4 }) + " SOL";
export const short = (key: PublicKey) => {
  const s = key.toBase58();
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
};
export const when = (unix: number) =>
  new Date(unix * 1000).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
export const nowSec = () => Math.floor(Date.now() / 1000);

export function timeLeft(unix: number): string {
  const s = unix - nowSec();
  if (s <= 0) return "ended";
  if (s >= 86400) return `${Math.floor(s / 86400)}d left`;
  if (s >= 3600) return `${Math.floor(s / 3600)}h left`;
  if (s >= 60) return `${Math.floor(s / 60)}m left`;
  return `${s}s left`;
}

export function explorerUrl(address: PublicKey | string): string {
  const key = typeof address === "string" ? address : address.toBase58();
  const cluster =
    NETWORK === "mainnet" ? "" : NETWORK === "devnet" ? "?cluster=devnet" : `?cluster=custom&customUrl=${encodeURIComponent(RPC_URL)}`;
  return `https://explorer.solana.com/address/${key}${cluster}`;
}

export function errorText(e: any): string {
  return e?.error?.errorMessage ?? e?.message ?? "The transaction failed";
}
