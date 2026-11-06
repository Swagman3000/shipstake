import { PromiseData, sol, timeLeft, when } from "./chain";

export const STATUS_LABEL = {
  active: "Open",
  proofPosted: "Proof posted",
  challenged: "Challenged",
  shipped: "Shipped",
  missed: "Missed",
};

export function StatusTag({ promise }: { promise: PromiseData }) {
  const cls = promise.status === "shipped" ? "ok" : promise.status === "missed" ? "miss" : "live";
  const label = promise.status === "active" ? timeLeft(promise.deadline) : STATUS_LABEL[promise.status];
  return <span className={`st mono ${cls}`}>{label}</span>;
}

export function PromiseRow({ promise, teamName }: { promise: PromiseData; teamName?: string }) {
  return (
    <a className="row" href={`#/promise/${promise.address.toBase58()}`}>
      <span className="p">
        {promise.title}
        <small className="mono">
          {teamName ?? "Team"} · {promise.backerCount} {promise.backerCount === 1 ? "backer" : "backers"}
        </small>
      </span>
      <span className="mono r">{sol(promise.stake)}</span>
      <span className="mono r due">{when(promise.deadline).split(",").slice(0, 1)}</span>
      <StatusTag promise={promise} />
    </a>
  );
}
