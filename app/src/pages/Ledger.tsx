import { useEffect, useMemo, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PromiseRow } from "../PromiseRow";
import { errorText, NETWORK, fetchPromises, fetchTeams, getProgram, PromiseData, TeamData } from "../chain";

export function Ledger() {
  const { connection } = useConnection();
  const program = useMemo(() => getProgram(connection), [connection]);
  const [rows, setRows] = useState<PromiseData[] | null>(null);
  const [teams, setTeams] = useState<Map<string, TeamData>>(new Map());
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([fetchPromises(program), fetchTeams(program)])
      .then(([p, t]) => {
        setRows(p);
        setTeams(t);
      })
      .catch((e) => setError(errorText(e)));
  }, [program]);

  return (
    <>
      <section className="ledger">
      <h2 className="section-title">The real ledger</h2>
      <p className="lede">Live from Solana {NETWORK}. Every promise here has real test SOL locked behind it.</p>
      <div className="panel">
        <div className="ph mono"><span>Promises</span><span>{rows ? rows.length : ""}</span></div>
        {error && <p className="empty error">Couldn't load promises: {error}</p>}
        {!error && !rows && <p className="empty">Loading promises…</p>}
        {rows?.length === 0 && (
          <div className="first"><h3>Nothing here yet.</h3><p>The first promise on this ledger stays on it for good.</p><a className="btn dark" href="#/new">Make the first promise →</a></div>
        )}
        {rows?.map((p) => <PromiseRow key={p.address.toBase58()} promise={p} teamName={teams.get(p.team.toBase58())?.name} />)}
      </div>
      </section>
    </>
  );
}
