import { useEffect, useMemo, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { PromiseRow } from "../PromiseRow";
import { errorText, explorerUrl, fetchPromises, fetchTeam, getProgram, PromiseData, short, sol, TeamData } from "../chain";

export function TeamRecord({ address }: { address: string }) {
  const { connection } = useConnection();
  const program = useMemo(() => getProgram(connection), [connection]);
  const [team, setTeam] = useState<TeamData | null | undefined>(undefined);
  const [rows, setRows] = useState<PromiseData[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let key: PublicKey;
    try {
      key = new PublicKey(address);
    } catch {
      return setTeam(null);
    }
    Promise.all([fetchTeam(program, key), fetchPromises(program)])
      .then(([t, all]) => {
        setTeam(t);
        setRows(all.filter((p) => p.team.equals(key)));
      })
      .catch((e) => setError(errorText(e)));
  }, [address, program]);

  if (error) return <p className="empty error">Couldn't load this team: {error}</p>;
  if (team === undefined) return <p className="empty">Loading record…</p>;
  if (team === null) return <p className="empty">No record for this wallet. <a href="#/">Back to the ledger</a></p>;

  const resolved = team.shippedCount + team.missedCount;

  return (
    <>
      <h1>{team.name}</h1>
      <p className="lede mono"><a href={explorerUrl(team.team)} target="_blank" rel="noreferrer noopener">{short(team.team)}</a></p>
      <div className="stats">
        <div><b>{team.shippedCount}<i> / {resolved}</i></b><span className="label mono">Shipped on time</span></div>
        <div><b>{sol(team.totalStaked)}</b><span className="label mono">Staked in total</span></div>
        <div><b>{sol(team.totalLost)}</b><span className="label mono">Paid to backers</span></div>
      </div>
      <div className="panel">
        <div className="ph mono"><span>Every promise</span><span>{rows.length}</span></div>
        {rows.map((p) => <PromiseRow key={p.address.toBase58()} promise={p} teamName={team.name} />)}
      </div>
    </>
  );
}
