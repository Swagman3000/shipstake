import { FormEvent, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { BN } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { errorText, fetchTeam, getProgram, promisePda, teamPda, toLamports } from "../chain";

function parseKey(text: string) {
  try {
    return new PublicKey(text.trim());
  } catch {
    return null;
  }
}

export function NewPromise() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const [form, setForm] = useState({ teamName: "", title: "", criteria: "", stake: "1", deadline: "", reviewer: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!wallet) return setError("Connect a wallet to make a promise.");
    const reviewer = parseKey(form.reviewer);
    if (!reviewer) return setError("The reviewer must be a valid Solana wallet address.");
    if (reviewer.equals(wallet.publicKey)) return setError("Your team can't review its own promise. Name another wallet.");
    const deadline = Math.floor(new Date(form.deadline).getTime() / 1000);
    if (!deadline) return setError("Pick a deadline.");

    setBusy(true);
    try {
      const program = getProgram(connection, wallet);
      const id = (await fetchTeam(program, wallet.publicKey))?.promiseCount ?? 0;
      const promise = promisePda(wallet.publicKey, id);
      await program.methods
        .createPromise(new BN(id), form.teamName.trim(), form.title.trim(), form.criteria.trim(), toLamports(Number(form.stake)), new BN(deadline), reviewer)
        .accountsPartial({ team: wallet.publicKey, profile: teamPda(wallet.publicKey), promise, systemProgram: SystemProgram.programId })
        .rpc();
      location.hash = `#/promise/${promise.toBase58()}`;
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Make a promise</h1>
      <p className="lede">The promise can't be edited after you lock the stake. Make it specific enough that a stranger could check it.</p>
      <form className="panel form" onSubmit={submit}>
        <label>
          <span className="label mono">Team name</span>
          <input id="team-name" required maxLength={40} value={form.teamName} onChange={set("teamName")} placeholder="Tidepool Wallet" />
        </label>
        <label>
          <span className="label mono">What will you ship?</span>
          <input id="title" required maxLength={120} value={form.title} onChange={set("title")} placeholder="Mobile app in public beta" />
        </label>
        <label>
          <span className="label mono">What counts as proof?</span>
          <textarea id="criteria" required maxLength={280} rows={3} value={form.criteria} onChange={set("criteria")} placeholder="A public TestFlight link that anyone can install" />
        </label>
        <div className="pair">
          <label>
            <span className="label mono">Stake (SOL)</span>
            <input id="stake" required type="number" min="0.01" step="any" value={form.stake} onChange={set("stake")} />
          </label>
          <label>
            <span className="label mono">Deadline</span>
            <input id="deadline" required type="datetime-local" value={form.deadline} onChange={set("deadline")} />
          </label>
        </div>
        <label>
          <span className="label mono">Reviewer wallet</span>
          <input id="reviewer" required className="mono" value={form.reviewer} onChange={set("reviewer")} placeholder="Solana address of someone neutral" />
          <small>This wallet rules only if a backer challenges your proof. If it doesn't rule within the review window, the promise counts as missed, so pick someone reliable.</small>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn dark" type="submit" disabled={busy}>{busy ? "Waiting for your wallet…" : `Lock ${form.stake || 0} SOL and publish`}</button>
      </form>
    </>
  );
}
