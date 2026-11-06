import { useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { NETWORK } from "./chain";
import { Ledger } from "./pages/Ledger";
import { NewPromise } from "./pages/NewPromise";
import { PromiseDetail } from "./pages/PromiseDetail";
import { TeamRecord } from "./pages/TeamRecord";
import { Verify } from "./pages/Verify";

function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const update = () => {
      setHash(location.hash);
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", update);
    return () => removeEventListener("hashchange", update);
  }, []);
  return hash.replace(/^#\/?/, "").split("/");
}

export function App() {
  const [page, param] = useRoute();

  return (
    <>
      <div className="pre mono">
        <span>
          <b>{NETWORK.toUpperCase()}</b> — Test network. This SOL has no value, and Shipstake isn't on mainnet.
        </span>
      </div>
      <div className="wrap">
        <header className="top">
          <a className="brand" href="/">Shipstake</a>
          <nav aria-label="App">
            <a href="#/">Promises</a>
            <a href="#/new">Make a promise</a>
            <a href="#/verify">Verify</a>
          </nav>
          <WalletMultiButton />
        </header>
        <main>
          {page === "new" ? <NewPromise /> : page === "verify" ? <Verify /> : page === "promise" ? <PromiseDetail address={param} /> : page === "team" ? <TeamRecord address={param} /> : <Ledger />}
        </main>
      </div>
    </>
  );
}
