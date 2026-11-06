import { useEffect, useState } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { NETWORK } from "./chain";
import logo from "./logo.svg";
import { Ledger } from "./pages/Ledger";
import { NewPromise } from "./pages/NewPromise";
import { PromiseDetail } from "./pages/PromiseDetail";
import { TeamRecord } from "./pages/TeamRecord";
import { Verify } from "./pages/Verify";
import { Simulator } from "./Simulator";

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
    <div className="wrap">
      <header className="top">
        <a className="brand" href="/" aria-label="Shipstake home">
          <img src={logo} alt="Shipstake" />
          <span className="mono net">{NETWORK}</span>
        </a>
        <nav aria-label="App">
          <a href="#/">Simulator</a>
          <a href="#/ledger">Ledger</a>
          <a href="#/new">Make a promise</a>
          <a href="#/verify">Verify</a>
        </nav>
        <WalletMultiButton />
      </header>
      <main>
        {page === "new" ? <NewPromise /> : page === "verify" ? <Verify /> : page === "promise" ? <PromiseDetail address={param} /> : page === "team" ? <TeamRecord address={param} /> : page === "ledger" ? <Ledger /> : <><Simulator /><Ledger /></>}
      </main>
      <footer className="note mono">Test network. This SOL has no value, and Shipstake isn't on mainnet.</footer>
    </div>
  );
}
