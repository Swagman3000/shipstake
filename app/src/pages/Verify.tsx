import { useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { errorText, explorerUrl, NETWORK, PROGRAM_ID } from "../chain";

const REPO_URL = import.meta.env.VITE_REPO_URL;
const AUDIT_URL = import.meta.env.VITE_AUDIT_URL;
const SITE_URL = import.meta.env.VITE_SITE_URL;

type ProgramState = { deployed: false } | { deployed: true; authority: PublicKey | null };

// Upgradeable programs point to a data account, which stores the upgrade key after a 12-byte header.
async function readProgram(connection: ReturnType<typeof useConnection>["connection"]): Promise<ProgramState> {
  const program = await connection.getAccountInfo(PROGRAM_ID);
  if (!program) return { deployed: false };
  const data = await connection.getAccountInfo(new PublicKey(program.data.subarray(4, 36)));
  if (!data) return { deployed: false };
  return { deployed: true, authority: data.data[12] === 1 ? new PublicKey(data.data.subarray(13, 45)) : null };
}

function Check({ name, ok, tag, children }: { name: string; ok: boolean; tag: string; children: React.ReactNode }) {
  return (
    <li>
      <b>{name}</b>
      <p>{children}</p>
      <span className={`st mono ${ok ? "ok" : "miss"}`}>{tag}</span>
    </li>
  );
}

const link = (href: string, text: string) => <a href={href} target="_blank" rel="noreferrer noopener">{text}</a>;

export function Verify() {
  const { connection } = useConnection();
  const [state, setState] = useState<ProgramState | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    readProgram(connection).then(setState).catch((e) => setError(errorText(e)));
  }, [connection]);

  const id = PROGRAM_ID.toBase58();

  return (
    <>
      <h1>Verify Shipstake</h1>
      <p className="lede">You shouldn't have to trust us. This page shows what you can check yourself, including what isn't ready yet.</p>

      <div className="verify-grid">
        <div className="panel">
          <div className="ph mono"><span>Status on {NETWORK}</span></div>
          {error && <p className="empty error">Couldn't read the program: {error}</p>}
          {!error && !state && <p className="empty">Reading the program from Solana…</p>}
          {state && (
            <ul className="checks">
              <Check name="Program" ok={state.deployed} tag={state.deployed ? "Deployed" : "Not deployed"}>
                <span className="mono">{id}</span>
                <br />
                {link(explorerUrl(id), "Open on Solana Explorer")}
              </Check>
              {state.deployed && (
                <Check name="Upgrade control" ok={!state.authority} tag={state.authority ? "Can change" : "Locked"}>
                  {state.authority ? (
                    <>
                      The wallet {link(explorerUrl(state.authority), state.authority.toBase58())} can replace this program, and a replacement could move the SOL in escrow. Check who controls it before you stake.
                    </>
                  ) : (
                    "Nobody can change this program. That also means bugs can't be fixed."
                  )}
                </Check>
              )}
              <Check name="Source code" ok={!!REPO_URL} tag={REPO_URL ? "Public" : "Not public"}>
                {REPO_URL ? link(REPO_URL, REPO_URL) : "The source code isn't published yet."}
              </Check>
              <Check name="Verified build" ok={false} tag="Check yourself">
                {REPO_URL ? <>Open the program on Solana Explorer and look for a verified build that matches the source code.</> : "This isn't possible until the source code is public."}
              </Check>
              <Check name="Security audit" ok={!!AUDIT_URL} tag={AUDIT_URL ? "Published" : "Not audited"}>
                {AUDIT_URL ? link(AUDIT_URL, "Read the full audit report") : "No independent audit has been done yet. Don't stake real funds."}
              </Check>
            </ul>
          )}
        </div>

        <div className="two-col">
          <div className="panel">
            <div className="ph mono"><span>Your wallet will only ask you to</span></div>
            <ul className="plain">
              <li>Lock a stake or backing deposit, for the amount shown on screen</li>
              <li>Post proof, challenge, or rule on a promise</li>
              <li>Settle a promise, or claim what you're owed</li>
            </ul>
          </div>
          <div className="panel">
            <div className="ph mono"><span>Shipstake will never ask for</span></div>
            <ul className="plain">
              <li>Your seed phrase or private key</li>
              <li>Token approvals or access to other assets</li>
              <li>Money sent directly to a person's wallet</li>
            </ul>
          </div>
        </div>

        <div className="panel">
          <div className="ph mono"><span>Check it in about two minutes</span></div>
          <ol className="steps-list">
            <li>{SITE_URL ? <>Make sure the address bar shows <span className="mono">{SITE_URL}</span>.</> : "Make sure you reached this page from an official Shipstake link."}</li>
            <li>Compare the program address above with the one in your wallet's transaction preview.</li>
            <li>Check who holds upgrade control.</li>
            <li>Read the preview before you sign. Reject anything that doesn't match the screen.</li>
            <li>Try a small amount first.</li>
          </ol>
        </div>
      </div>
    </>
  );
}
