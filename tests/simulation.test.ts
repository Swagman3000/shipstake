import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildSteps, Scenario, SCENARIOS } from "../app/src/simulation";

const inputs = { stake: 500, you: 13, others: 40 };
const backed = inputs.you + inputs.others;
const total = inputs.stake + backed;
const expected: Record<Scenario, { outcome: string; day: number; titles: string[] }> = {
  misses: { outcome: "missed", day: 30, titles: ["Missed"] },
  ships: { outcome: "shipped", day: 30, titles: ["Team posts proof", "Shipped"] },
  rejected: { outcome: "missed", day: 32, titles: ["Team posts proof", "A backer challenges", "Missed"] },
  upheld: { outcome: "shipped", day: 32, titles: ["Team posts proof", "A backer challenges", "Shipped"] },
  silent: { outcome: "missed", day: 36, titles: ["Team posts proof", "A backer challenges", "Missed"] },
};

describe("simulator", () => {
  for (const { id } of SCENARIOS) {
    describe(id, () => {
      const steps = buildSteps(id, inputs);
      const end = steps[steps.length - 1];

      it("never creates or loses SOL", () => {
        for (const s of steps) assert.equal(s.team + s.escrow + s.backers, total, s.title);
      });

      it("never shows a negative balance", () => {
        for (const s of steps) assert.ok(s.team >= 0 && s.escrow >= 0 && s.backers >= 0, s.title);
      });

      it("runs forward in time", () => {
        for (let i = 1; i < steps.length; i++) assert.ok(steps[i].day >= steps[i - 1].day, steps[i].title);
      });

      it("locks the stake and deposits before anything else happens", () => {
        assert.deepEqual(steps.slice(0, 4).map((s) => s.title), ["Promise published", "Stake locked", "Backers join", "Backing closes"]);
        assert.equal(steps[3].escrow, total);
      });

      it("follows the right path and ends on the right day", () => {
        assert.deepEqual(steps.slice(4).map((s) => s.title), expected[id].titles);
        assert.equal(end.day, expected[id].day);
        assert.equal(end.outcome, expected[id].outcome);
      });

      it("empties escrow and pays the right side", () => {
        assert.equal(end.escrow, 0);
        assert.equal(end.team, end.outcome === "shipped" ? inputs.stake : 0);
        assert.equal(end.backers, end.outcome === "shipped" ? backed : total);
      });

      it("only marks the last step as an outcome", () => {
        assert.equal(steps.filter((s) => s.outcome).length, 1);
      });
    });
  }

  it("posts proof before the deadline and keeps windows to the program's timers", () => {
    const silent = buildSteps("silent", inputs);
    const proof = silent.find((s) => s.title === "Team posts proof")!;
    const challenge = silent.find((s) => s.title === "A backer challenges")!;
    assert.ok(proof.day <= 30);
    assert.ok(challenge.day - proof.day <= 3);
    assert.equal(silent[silent.length - 1].day - challenge.day, 7);
  });
});
