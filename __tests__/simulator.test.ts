import { describe, expect, it } from "@jest/globals";

import { Grade, Subject } from "@/services/shared/grade";
import {
  anchorsFrom,
  formatAverage,
  gradeKey,
  NO_ANCHORS,
  overallAverage,
  parseNumber,
  requiredForOverall,
  requiredForSubject,
  SimulationState,
  subjectAverage,
} from "@/utils/grades/simulator";

const grade = (subjectId: string, id: string, value: number, coefficient = 1, outOf = 20): Grade => ({
  id,
  subjectId,
  subjectName: subjectId,
  description: "",
  coefficient,
  outOf: { value: outOf },
  studentScore: { value },
  createdByAccount: "test",
});

const subject = (id: string, grades: Grade[], official?: number): Subject => ({
  id,
  name: id,
  classAverage: { value: 0 },
  outOf: { value: 20 },
  studentAverage: official === undefined ? undefined : { value: official },
  grades,
});

const empty = (): SimulationState => ({ simulated: [], excluded: new Set() });

describe("simulator: averages", () => {
  const maths = subject("maths", [grade("maths", "a", 10), grade("maths", "b", 16)]);

  it("computes a weighted subject average", () => {
    const weighted = subject("phys", [grade("phys", "a", 10, 1), grade("phys", "b", 16, 2)]);
    expect(subjectAverage(weighted, empty())).toBeCloseTo(14);
  });

  it("adds simulated grades", () => {
    const state: SimulationState = {
      simulated: [{ id: "s", subjectId: "maths", score: 19, outOf: 20, coefficient: 1 }],
      excluded: new Set(),
    };
    expect(subjectAverage(maths, state)).toBeCloseTo(15);
  });

  it("leaves excluded grades out", () => {
    const state: SimulationState = { simulated: [], excluded: new Set([gradeKey(maths.grades![0], 0)]) };
    expect(subjectAverage(maths, state)).toBeCloseTo(16);
  });

  it("returns -1 when nothing counts", () => {
    expect(subjectAverage(subject("x", []), empty())).toBe(-1);
    expect(overallAverage([subject("x", [])], empty())).toBe(-1);
  });

  it("averages subjects without anchors", () => {
    const french = subject("fr", [grade("fr", "a", 8)]);
    expect(overallAverage([maths, french], empty())).toBeCloseTo((13 + 8) / 2);
  });
});

describe("simulator: anchoring on official averages", () => {
  // Pronote says 17,09 where Papillon computes 16,99: the simulator must start
  // from the official figure and move by the simulated difference.
  const maths = subject("maths", [grade("maths", "a", 16), grade("maths", "b", 18)], 17.09);

  it("shows the official average when nothing changed", () => {
    const anchors = anchorsFrom([maths], { value: 17.09 });
    expect(subjectAverage(maths, empty(), [], anchors)).toBeCloseTo(17.09);
    expect(overallAverage([maths], empty(), [], anchors)).toBeCloseTo(17.09);
  });

  it("moves by the simulated difference", () => {
    const anchors = anchorsFrom([maths], { value: 17.09 });
    const state: SimulationState = {
      simulated: [{ id: "s", subjectId: "maths", score: 20, outOf: 20, coefficient: 1 }],
      excluded: new Set(),
    };
    // Raw: 17 → 18 (+1), anchored: 17.09 → 18.09.
    expect(subjectAverage(maths, state, [], anchors)).toBeCloseTo(18.09);
  });

  it("normalises official averages to /20 and ignores disabled ones", () => {
    const onTen: Subject = { ...maths, outOf: { value: 10 }, studentAverage: { value: 8 } };
    const disabled: Subject = { ...maths, id: "d", studentAverage: { value: 12, disabled: true } };
    const anchors = anchorsFrom([onTen, disabled], { value: 5, disabled: true });
    expect(anchors.subjects.maths).toBeCloseTo(16);
    expect(anchors.subjects.d).toBeUndefined();
    expect(anchors.overall).toBeUndefined();
  });

  it("clamps to 0–20", () => {
    const anchors = { subjects: { maths: 19.9 } };
    const state: SimulationState = {
      simulated: [{ id: "s", subjectId: "maths", score: 20, outOf: 20, coefficient: 10 }],
      excluded: new Set(),
    };
    expect(subjectAverage(maths, state, [], anchors)).toBeLessThanOrEqual(20);
  });
});

describe("simulator: required score", () => {
  const maths = subject("maths", [grade("maths", "a", 10)]);

  it("finds the score needed, rounded up to 0.25", () => {
    const result = requiredForSubject(maths, empty(), 12);
    expect(result).toEqual({ kind: "needed", score: 14 });
  });

  it("says when the target is already reached", () => {
    expect(requiredForSubject(maths, empty(), 5)).toEqual({ kind: "reached" });
  });

  it("says when the target is out of reach", () => {
    const result = requiredForSubject(maths, empty(), 19);
    expect(result.kind).toBe("impossible");
    if (result.kind === "impossible") {expect(result.best).toBeCloseTo(15);}
  });

  it("works on the overall average", () => {
    const french = subject("fr", [grade("fr", "a", 14)]);
    // Mean of 10 and 14 is 12; for 13 maths must reach 12 → one more grade of 14.
    expect(requiredForOverall([maths, french], "maths", empty(), 13, 20, 1, NO_ANCHORS)).toEqual({ kind: "needed", score: 14 });
  });
});

describe("simulator: formatting", () => {
  it("parses French and English decimals", () => {
    expect(parseNumber("15,5")).toBe(15.5);
    expect(parseNumber(" 12.25 ")).toBe(12.25);
    expect(parseNumber("")).toBeNaN();
    expect(parseNumber("abc")).toBeNaN();
  });

  it("formats averages", () => {
    expect(formatAverage(12.345)).toBe("12,35");
    expect(formatAverage(-1)).toBe("—");
  });
});
