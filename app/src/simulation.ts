export type Scenario = "ships" | "misses" | "upheld" | "rejected" | "silent";

export const SCENARIOS: { id: Scenario; label: string }[] = [
  { id: "misses", label: "Team misses the date" },
  { id: "ships", label: "Team ships on time" },
  { id: "rejected", label: "Weak proof is rejected" },
  { id: "upheld", label: "Challenge fails" },
  { id: "silent", label: "Reviewer goes silent" },
];

export type Flow = { to: "escrow" | "team" | "backers"; from: "escrow" | "team" | "backers"; amount: number };

export interface Step {
  day: number;
  title: string;
  text: string;
  flows: Flow[];
  team: number;
  escrow: number;
  backers: number;
  outcome?: "shipped" | "missed";
}

export interface Inputs {
  stake: number;
  you: number;
  others: number;
}

export const DEADLINE = 30;
export const BACKING_CLOSES = 15;

// Mirrors the program's rules: deposits always return, and a missed stake is split by amount backed.
export function buildSteps(scenario: Scenario, { stake, you, others }: Inputs): Step[] {
  const backed = you + others;
  const steps: Step[] = [];
  let team = stake;
  let escrow = 0;
  let backers = backed;

  const add = (day: number, title: string, text: string, flows: Flow[] = [], outcome?: Step["outcome"]) => {
    for (const f of flows) {
      if (f.from === "team") team -= f.amount;
      if (f.from === "backers") backers -= f.amount;
      if (f.from === "escrow") escrow -= f.amount;
      if (f.to === "team") team += f.amount;
      if (f.to === "backers") backers += f.amount;
      if (f.to === "escrow") escrow += f.amount;
    }
    steps.push({ day, title, text, flows, team, escrow, backers, outcome });
  };

  const shipped = (day: number, why: string) =>
    add(day, "Shipped", `${why} The team gets its stake back, every backer gets their deposit back, and the delivery goes on the team's record.`, [
      { from: "escrow", to: "team", amount: stake },
      { from: "escrow", to: "backers", amount: backed },
    ], "shipped");

  const missed = (day: number, why: string) =>
    add(day, "Missed", `${why} The stake is split between backers by how much each one backed, and they get their deposits back too.`, [
      { from: "escrow", to: "backers", amount: stake + backed },
    ], "missed");

  add(0, "Promise published", "The team writes down what it will ship, what counts as proof, and who reviews disputes. None of this can be edited later.");
  add(0, "Stake locked", "The team's SOL moves into escrow. Nobody can pull it out early.", [{ from: "team", to: "escrow", amount: stake }]);
  add(6, "Backers join", "Backers lock refundable deposits. Bigger deposits earn a bigger share if the team misses.", [{ from: "backers", to: "escrow", amount: backed }]);
  add(BACKING_CLOSES, "Backing closes", "Halfway to the deadline, nobody else can join. That stops people piling in once a miss looks certain.");

  if (scenario === "misses") {
    missed(DEADLINE, "The deadline passes with no proof.");
    return steps;
  }

  add(27, "Team posts proof", scenario === "ships" || scenario === "upheld" ? "The team posts a public link to what it shipped. A 72-hour challenge window opens." : "The team posts a link, but it doesn't meet the test in the promise. A 72-hour challenge window opens.");

  if (scenario === "ships") {
    shipped(30, "72 hours pass and nobody challenges the proof.");
    return steps;
  }

  add(29, "A backer challenges", "A backer disputes the proof. The named reviewer now has 7 days to rule.");
  if (scenario === "upheld") {
    shipped(32, "The reviewer checks the proof against the promise and finds it meets the test.");
  } else if (scenario === "rejected") {
    missed(32, "The reviewer finds the proof doesn't meet the test.");
  } else {
    missed(36, "The reviewer never rules. The team chose them, so the silence counts against the team.");
  }
  return steps;
}

export const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
