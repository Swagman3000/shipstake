import { useEffect, useMemo, useRef, useState } from "react";
import { BACKING_CLOSES, buildSteps, DEADLINE, Flow, fmt, Scenario, SCENARIOS } from "./simulation";

const TRAVEL_MS = 1500; // how long money takes to move, matching the dot animation
const STEP_MS = 3000;
const LAST_DAY = 36;
const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// Runs from 0 to 1 over `duration` each time `key` changes. All balances share this one
// clock, so they always add up. A new key reads as 0 straight away, so old values never show.
function useProgress(key: string, duration: number) {
  const [state, setState] = useState({ key, t: 1 });

  useEffect(() => {
    if (duration === 0) return;
    const started = performance.now();
    const timer = setInterval(() => {
      const t = Math.min(1, (performance.now() - started) / duration);
      setState({ key, t });
      if (t === 1) clearInterval(timer);
    }, 33);
    return () => clearInterval(timer);
  }, [key, duration]);

  if (duration === 0) return 1;
  return state.key === key ? state.t : 0;
}

function Track({ flow, side }: { flow?: Flow; side: "left" | "right" }) {
  const towardTeam = side === "left" && flow?.to === "team";
  const towardEscrow = side === "right" && flow?.to === "escrow";
  return (
    <div className={`track ${flow ? "on" : ""} ${towardTeam || towardEscrow ? "go-back" : ""}`} aria-hidden="true">
      {flow && (
        <>
          <span className="amount mono">{fmt(flow.amount)} SOL</span>
          <i /><i /><i />
        </>
      )}
    </div>
  );
}

function Node({ name, value, note, hot, vault }: { name: string; value: number; note: string; hot: boolean; vault?: boolean }) {
  return (
    <div className={`node ${vault ? "vault" : ""} ${hot ? "hot" : ""}`}>
      <span className="label mono">{name}</span>
      <b>{fmt(value)}</b>
      <small className="mono">{note}</small>
    </div>
  );
}

function Slider({ id, label, value, min, max, onChange }: { id: string; label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <label htmlFor={id} className="slider">
      <span className="label mono">{label}</span>
      <b className="mono">{value} SOL</b>
      <input id={id} type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Simulator() {
  // One state object, so a new outcome and its first step always appear together.
  const [play, setPlay] = useState<{ scenario: Scenario; run: number; index: number }>({ scenario: "misses", run: 0, index: 0 });
  const [stake, setStake] = useState(50);
  const [you, setYou] = useState(5);
  const [others, setOthers] = useState(20);
  const logRef = useRef<HTMLOListElement>(null);

  const steps = useMemo(() => buildSteps(play.scenario, { stake, you, others }), [play.scenario, stake, you, others]);
  const last = steps.length - 1;
  const at = Math.min(play.index, last);
  const step = steps[at];
  const finished = at === last;
  const start = (scenario: Scenario) => setPlay((p) => ({ scenario, run: p.run + 1, index: reducedMotion() ? 99 : 0 }));

  useEffect(() => {
    if (reducedMotion()) {
      setPlay((p) => ({ ...p, index: 99 }));
      return;
    }
    if (play.index >= last) return;
    const timer = setTimeout(() => setPlay((p) => ({ ...p, index: p.index + 1 })), STEP_MS);
    return () => clearTimeout(timer);
  }, [play.run, play.index, last]);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [at]);

  const travel = step.flows.length > 0 && !reducedMotion() ? TRAVEL_MS : 0;
  const t = useProgress(`${play.run}-${at}`, travel);
  const before = steps[Math.max(at - 1, 0)];
  const eased = t * (2 - t);
  const between = (from: number, to: number) => (t === 1 ? to : Math.round(from + (to - from) * eased));
  const team = between(before.team, step.team);
  const backers = between(before.backers, step.backers);
  const escrow = step.team + step.escrow + step.backers - team - backers;

  const teamFlow = step.flows.find((f) => f.from === "team" || f.to === "team");
  const backersFlow = step.flows.find((f) => f.from === "backers" || f.to === "backers");
  const yourShare = (stake * you) / (you + others);
  const trackKey = `${play.run}-${at}`;

  return (
    <section className="sim" aria-label="Promise simulator">
      <div className="sim-intro">
        <h1>Watch a promise <em>play out.</em></h1>
        <p className="lede">Choose what happens and follow the money. This is a simulation, so nothing touches your wallet.</p>
      </div>

      <div className="chips" role="group" aria-label="Choose what happens">
        {SCENARIOS.map((s) => (
          <button key={s.id} id={`sim-${s.id}`} type="button" className={s.id === play.scenario ? "chip on" : "chip"} aria-pressed={s.id === play.scenario} onClick={() => start(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      <div className={`stage ${step.outcome ?? ""}`}>
        <div className="flowmap">
          <Node
            name="Team"
            value={team}
            hot={!!teamFlow}
            note={step.outcome === "shipped" ? "stake returned" : step.outcome === "missed" ? `lost ${fmt(stake)} SOL` : "SOL in wallet"}
          />
          <Track key={`l-${trackKey}`} flow={teamFlow} side="left" />
          <Node name="Escrow" vault value={escrow} hot={step.flows.length > 0} note="SOL locked" />
          <Track key={`r-${trackKey}`} flow={backersFlow} side="right" />
          <Node
            name="Backers"
            value={backers}
            hot={!!backersFlow}
            note={step.outcome === "shipped" ? "deposits returned" : step.outcome === "missed" ? `deposits + ${fmt(stake)} SOL` : "SOL in wallets"}
          />
        </div>

        <div className="rail" aria-hidden="true">
          <div className={`fill ${at === 0 ? "reset" : ""}`} style={{ width: `${(step.day / LAST_DAY) * 100}%` }} />
          <span className="mark mono" style={{ left: `${(BACKING_CLOSES / LAST_DAY) * 100}%` }}>Backing closes</span>
          <span className="mark mono" style={{ left: `${(DEADLINE / LAST_DAY) * 100}%` }}>Deadline</span>
        </div>

        <div className="now" aria-live="polite">
          <span className="mono day">Day {step.day}</span>
          <div>
            <h2>{step.title}</h2>
            <p>{step.text}</p>
          </div>
          {step.outcome && <span className={`stamp ${step.outcome}`}>{step.outcome === "shipped" ? "Shipped" : "Missed"}</span>}
        </div>
      </div>

      <div className="sim-lower">
        <div className="panel controls">
          <div className="ph mono"><span>Set the numbers</span></div>
          <div className="sliders">
            <Slider id="sim-stake" label="Team's stake" value={stake} min={1} max={500} onChange={setStake} />
            <Slider id="sim-you" label="You back" value={you} min={1} max={100} onChange={setYou} />
            <Slider id="sim-others" label="Others back" value={others} min={0} max={200} onChange={setOthers} />
          </div>
          <div className="payoff">
            <div><span className="label mono">If the team ships</span><b>{fmt(you)} SOL</b><small>Your deposit back</small></div>
            <div className="hit"><span className="label mono">If the team misses</span><b>{fmt(you + yourShare)} SOL</b><small>Deposit plus {fmt(yourShare)} SOL of the stake</small></div>
          </div>
        </div>

        <div className="panel">
          <div className="ph mono"><span>What happened</span><span>{finished ? <button type="button" className="replay" onClick={() => start(play.scenario)}>Replay ↻</button> : `${at + 1} of ${steps.length}`}</span></div>
          <ol className="log" ref={logRef}>
            {steps.slice(0, at + 1).map((s, i) => (
              <li key={`${play.run}-${i}`}><span className="mono">Day {s.day}</span><b>{s.title}</b></li>
            ))}
          </ol>
        </div>
      </div>

      <div className="sim-cta">
        <a className="btn dark" href="#/new">Make a real promise on devnet →</a>
        <a className="btn line" href="#/verify">Check that it's real</a>
      </div>
    </section>
  );
}
