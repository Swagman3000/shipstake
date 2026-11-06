import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { StatusTag } from "../PromiseRow";
import {
  BackingData, backingPda, errorText, explorerUrl, fetchBackings, fetchPromise, fetchTeam, getProgram, nowSec, PromiseData, short, sol, TeamData, teamPda, timeLeft, toLamports, when,
} from "../chain";

function nextStep(p: PromiseData) {
  const now = nowSec();
  switch (p.status) {
    case "active":
      return now > p.deadline
        ? "The deadline passed with no proof. Anyone can settle this promise as missed."
        : now > p.backingClosesAt
          ? "Backing has closed. The team has until the deadline to post proof."
          : "Backing is open. It closes halfway to the deadline.";
    case "proofPosted":
      return now > p.challengeEndsAt
        ? "Nobody challenged the proof. Anyone can settle this promise as shipped."
        : `Backers can challenge this proof until ${when(p.challengeEndsAt)}.`;
    case "challenged":
      return now > p.reviewEndsAt
        ? "The reviewer didn't rule in time. Anyone can settle this promise as missed."
        : `The reviewer has until ${when(p.reviewEndsAt)} to rule.`;
    case "shipped":
      return "Delivered. The stake goes back to the team, and backers can reclaim their deposits.";
    case "missed":
      return p.totalBacked > 0
        ? "Missed. Backers can claim their deposits plus their share of the stake."
        : "Missed with no backers, so the stake goes back to the team.";
  }
}

export function PromiseDetail({ address }: { address: string }) {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();
  const program = useMemo(() => getProgram(connection, wallet), [connection, wallet]);
  const key = useMemo(() => {
    try {
      return new PublicKey(address);
    } catch {
      return null;
    }
  }, [address]);

  const [promise, setPromise] = useState<PromiseData | null | undefined>(undefined);
  const [team, setTeam] = useState<TeamData | null>(null);
  const [backings, setBackings] = useState<BackingData[]>([]);
  const [amount, setAmount] = useState("0.5");
  const [proof, setProof] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!key) return setPromise(null);
    const p = await fetchPromise(program, key);
    setPromise(p);
    if (p) {
      setBackings(await fetchBackings(program, key));
      setTeam(await fetchTeam(program, p.team));
    }
  }, [key, program]);

  useEffect(() => {
    load().catch((e) => setError(errorText(e)));
    const timer = setInterval(() => load().catch(() => {}), 15000);
    return () => clearInterval(timer);
  }, [load]);

  if (promise === undefined) return <p className="empty">{error || "Loading promise…"}</p>;
  if (promise === null || !key) return <p className="empty">This promise doesn't exist on {connection.rpcEndpoint.includes("devnet") ? "devnet" : "this network"}. <a href="#/">Back to the ledger</a></p>;

  const p = promise;
  const me = wallet?.publicKey;
  const now = nowSec();
  const isTeam = !!me && me.equals(p.team);
  const isReviewer = !!me && me.equals(p.reviewer);
  const mine = me ? backings.find((b) => b.backer.equals(me)) : undefined;
  const settled = p.status === "shipped" || p.status === "missed";
  const profile = teamPda(p.team);
  const topShare = p.totalBacked > 0 && backings[0] ? Math.round((backings[0].amount / p.totalBacked) * 100) : 0;
  const share = mine && p.status === "missed" ? Math.floor((p.stake * mine.amount) / p.totalBacked) : 0;

  const canBack = p.status === "active" && now <= p.backingClosesAt && !isTeam && !isReviewer;
  const canProve = isTeam && p.status === "active" && now <= p.deadline;
  const canChallenge = !!mine && p.status === "proofPosted" && now <= p.challengeEndsAt;
  const canRule = isReviewer && p.status === "challenged" && now <= p.reviewEndsAt;
  const canSettle =
    (p.status === "active" && now > p.deadline) ||
    (p.status === "proofPosted" && now > p.challengeEndsAt) ||
    (p.status === "challenged" && now > p.reviewEndsAt);
  const canWithdraw = isTeam && !p.stakeWithdrawn && (p.status === "shipped" || (p.status === "missed" && p.totalBacked === 0));
  const canClaim = !!mine && settled;

  async function run(action: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await action();
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  const backingAccount = me ? backingPda(key, me) : undefined;
  const back = (e: FormEvent) => {
    e.preventDefault();
    if (!me) return setError("Connect a wallet to back this promise.");
    run(() =>
      program.methods.back(toLamports(Number(amount)))
        .accountsPartial({ backer: me, promise: key, backing: backingAccount, systemProgram: SystemProgram.programId }).rpc());
  };
  const postProof = (e: FormEvent) => {
    e.preventDefault();
    run(() => program.methods.postProof(proof.trim()).accountsPartial({ team: me, promise: key }).rpc());
  };
  const challenge = () => run(() => program.methods.challenge().accountsPartial({ backer: me, promise: key, backing: backingAccount }).rpc());
  const rule = (shipped: boolean) => run(() => program.methods.rule(shipped).accountsPartial({ reviewer: me, promise: key, profile }).rpc());
  const settle = () => run(() => program.methods.finalize().accountsPartial({ promise: key, profile }).rpc());
  const withdraw = () => run(() => program.methods.withdrawStake().accountsPartial({ team: me, promise: key }).rpc());
  const claim = () => run(() => program.methods.claimBacking().accountsPartial({ backer: me, promise: key, backing: backingAccount }).rpc());

  return (
    <>
      <p className="crumb mono">
        <a href={`#/team/${p.team.toBase58()}`}>{team?.name ?? short(p.team)}</a> · Promise {p.id + 1}
      </p>
      <h1>{p.title}</h1>
      <div className="headline"><StatusTag promise={p} /><p>{nextStep(p)}</p></div>

      <div className="detail">
        <div className="panel">
          <dl className="facts">
            <div><dt className="label mono">Stake locked</dt><dd className="mono">{sol(p.stake)}</dd></div>
            <div><dt className="label mono">Backed by</dt><dd className="mono">{sol(p.totalBacked)} · {p.backerCount}</dd></div>
            <div><dt className="label mono">Backing closes</dt><dd className="mono">{when(p.backingClosesAt)}</dd></div>
            <div><dt className="label mono">Deadline</dt><dd className="mono">{when(p.deadline)} · {timeLeft(p.deadline)}</dd></div>
            <div><dt className="label mono">Reviewer</dt><dd className="mono"><a href={explorerUrl(p.reviewer)} target="_blank" rel="noreferrer noopener">{short(p.reviewer)}</a></dd></div>
            <div><dt className="label mono">Team wallet</dt><dd className="mono"><a href={explorerUrl(p.team)} target="_blank" rel="noreferrer noopener">{short(p.team)}</a></dd></div>
          </dl>
          <div className="block">
            <span className="label mono">What counts as proof</span>
            <p>{p.criteria}</p>
          </div>
          <div className="block">
            <span className="label mono">Check it on-chain</span>
            <p><a href={explorerUrl(p.address)} target="_blank" rel="noreferrer noopener">See this promise and its locked SOL on Solana Explorer</a></p>
          </div>
          {p.proofUri && (
            <div className="block">
              <span className="label mono">Team's proof · {when(p.proofAt)}</span>
              {/^https?:\/\//.test(p.proofUri) ? <p><a href={p.proofUri} target="_blank" rel="noreferrer noopener">{p.proofUri}</a></p> : <p>{p.proofUri}</p>}
            </div>
          )}
          {backings.length > 0 && (
            <div className="block">
              <span className="label mono">Backers</span>
              {topShare >= 50 && backings.length > 0 && (
                <p className="warn">One wallet holds {topShare}% of this backing. If it belongs to the team, a miss would cost the team far less than the stake suggests.</p>
              )}
              <ul className="backers mono">
                {backings.slice(0, 8).map((b) => (
                  <li key={b.address.toBase58()}><a href={explorerUrl(b.backer)} target="_blank" rel="noreferrer noopener">{short(b.backer)}</a><span>{sol(b.amount)}</span></li>
                ))}
              </ul>
              {backings.length > 8 && <p className="muted">and {backings.length - 8} more</p>}
            </div>
          )}
        </div>

        <aside className="panel actions">
          <div className="ph mono"><span>What you can do</span></div>
          {!wallet && <p className="muted">Connect a wallet to back, challenge or claim.</p>}
          {error && <p className="error" role="alert">{error}</p>}

          {canBack && wallet && (
            <form onSubmit={back}>
              <label><span className="label mono">Back this promise (SOL)</span>
                <input id="back-amount" type="number" min="0.001" step="any" required value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <small>You get this deposit back either way. It stays locked until the promise settles. If the team misses, you also get your share of the stake.</small>
              <button className="btn dark" disabled={busy}>Back with {amount || 0} SOL</button>
            </form>
          )}
          {canProve && (
            <form onSubmit={postProof}>
              <label><span className="label mono">Post your proof</span>
                <input id="proof" required maxLength={200} value={proof} onChange={(e) => setProof(e.target.value)} placeholder="https://" />
              </label>
              <small>You can post proof once. It starts the challenge window.</small>
              <button className="btn dark" disabled={busy}>Post proof</button>
            </form>
          )}
          {canChallenge && <button className="btn line" disabled={busy} onClick={challenge}>Challenge this proof</button>}
          {canRule && (
            <div className="pairbtn">
              <button className="btn dark" disabled={busy} onClick={() => rule(true)}>Rule: shipped</button>
              <button className="btn line" disabled={busy} onClick={() => rule(false)}>Rule: missed</button>
            </div>
          )}
          {canSettle && <button className="btn dark" disabled={busy} onClick={settle}>Settle this promise</button>}
          {canWithdraw && <button className="btn dark" disabled={busy} onClick={withdraw}>Withdraw {sol(p.stake)}</button>}
          {canClaim && <button className="btn dark" disabled={busy} onClick={claim}>Claim {sol(mine!.amount + share)}</button>}
          {wallet && !canBack && !canProve && !canChallenge && !canRule && !canSettle && !canWithdraw && !canClaim && (
            <p className="muted">Nothing for this wallet to do right now.</p>
          )}
        </aside>
      </div>
    </>
  );
}
