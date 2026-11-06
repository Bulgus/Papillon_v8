import { Grade, Subject } from "@/services/shared/grade";

import { getSubjectAverage } from "./algorithms/subject";

/**
 * Grade simulator: "what if" grades, excluded grades, and the score needed
 * to reach a target. Averages are on /20.
 *
 * Results are anchored on the service's own averages (what the Grades tab
 * shows): with no change the simulator shows exactly them, and each change
 * moves them by the difference Papillon's calculation gives. Without
 * anchors, the overall average is the mean of the subject averages.
 */

export interface SimulatedGrade {
  id: string;
  subjectId: string;
  score: number;
  outOf: number;
  coefficient: number;
}

export interface SimulationState {
  simulated: SimulatedGrade[];
  /** Keys of real grades left out of the calculation (see gradeKey). */
  excluded: Set<string>;
}

/** Official averages (/20) to start from, when the service gives them. */
export interface Anchors {
  overall?: number;
  subjects: Record<string, number>;
}

export const NO_ANCHORS: Anchors = { subjects: {} };
const EMPTY: SimulationState = { simulated: [], excluded: new Set() };

/** Service averages of a period, normalised to /20. */
export function anchorsFrom(subjects: Subject[], overall?: { value: number; disabled?: boolean } | null): Anchors {
  const result: Anchors = { subjects: {} };
  for (const subject of subjects) {
    const score = subject.studentAverage;
    const outOf = subject.outOf?.value || 20;
    if (score && !score.disabled && typeof score.value === "number" && score.value >= 0) {
      result.subjects[subject.id] = (score.value / outOf) * 20;
    }
  }
  if (overall && !overall.disabled && typeof overall.value === "number" && overall.value >= 0) {
    result.overall = overall.value;
  }
  return result;
}

export const gradeKey = (grade: Grade, index: number) =>
  grade.id ? `${grade.subjectId}:${grade.id}` : `${grade.subjectId}:#${index}`;

export function toGrade(sim: SimulatedGrade, subject: Subject): Grade {
  return {
    id: sim.id,
    subjectId: subject.id,
    subjectName: subject.name,
    description: "Simulation",
    coefficient: sim.coefficient,
    outOf: { value: sim.outOf },
    studentScore: { value: sim.score },
    createdByAccount: "simulator",
  };
}

/** Grades of a subject as they count in the simulation. */
export function simulatedGradesFor(subject: Subject, state: SimulationState, extra: SimulatedGrade[] = []): Grade[] {
  const real = (subject.grades ?? []).filter((grade, index) => !state.excluded.has(gradeKey(grade, index)));
  const sims = [...state.simulated, ...extra]
    .filter(sim => sim.subjectId === subject.id)
    .map(sim => toGrade(sim, subject));
  return [...real, ...sims];
}

const clamp = (value: number) => Math.min(20, Math.max(0, value));

/** Papillon's own subject average, -1 when no grade counts. */
function rawSubjectAverage(subject: Subject, state: SimulationState, extra: SimulatedGrade[] = []): number {
  return getSubjectAverage(simulatedGradesFor(subject, state, extra));
}

/** Subject average, anchored on the official one. -1 when nothing counts. */
export function subjectAverage(
  subject: Subject,
  state: SimulationState,
  extra: SimulatedGrade[] = [],
  anchors: Anchors = NO_ANCHORS
): number {
  const simulated = rawSubjectAverage(subject, state, extra);
  const anchor = anchors.subjects[subject.id];
  if (anchor === undefined) {return simulated;}
  const base = rawSubjectAverage(subject, EMPTY);
  if (simulated === -1) {return -1;}
  if (base === -1) {return simulated;}
  return clamp(anchor + (simulated - base));
}

function meanOfSubjects(subjects: Subject[], state: SimulationState, extra: SimulatedGrade[], anchors: Anchors): number {
  let total = 0;
  let count = 0;
  for (const subject of subjects) {
    const average = subjectAverage(subject, state, extra, anchors);
    if (average !== -1) {
      total += average;
      count++;
    }
  }
  return count > 0 ? total / count : -1;
}

/** Overall average, anchored on the official one. -1 when nothing counts. */
export function overallAverage(
  subjects: Subject[],
  state: SimulationState,
  extra: SimulatedGrade[] = [],
  anchors: Anchors = NO_ANCHORS
): number {
  const simulated = meanOfSubjects(subjects, state, extra, anchors);
  if (anchors.overall === undefined || simulated === -1) {return simulated;}
  const base = meanOfSubjects(subjects, EMPTY, [], anchors);
  if (base === -1) {return simulated;}
  return clamp(anchors.overall + (simulated - base));
}

export type RequiredScore =
  | { kind: "reached" }
  | { kind: "impossible"; best: number }
  | { kind: "needed"; score: number };

/**
 * Smallest score (on `outOf`, rounded up to 0.25) for one more grade in
 * `subjectId` so that `measure` reaches `target`.
 */
function solve(
  measure: (extra: SimulatedGrade[]) => number,
  subjectId: string,
  target: number,
  outOf: number,
  coefficient: number
): RequiredScore {
  const probe = (score: number) =>
    measure([{ id: "probe", subjectId, score, outOf, coefficient }]);

  if (probe(0) >= target - 1e-9) {return { kind: "reached" };}
  const best = probe(outOf);
  if (best < target - 1e-9) {return { kind: "impossible", best };}

  let low = 0;
  let high = outOf;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) / 2;
    if (probe(mid) >= target - 1e-9) {high = mid;} else {low = mid;}
  }
  const rounded = Math.min(outOf, Math.ceil(high * 4 - 1e-6) / 4);
  return { kind: "needed", score: rounded };
}

export function requiredForSubject(
  subject: Subject,
  state: SimulationState,
  target: number,
  outOf = 20,
  coefficient = 1,
  anchors: Anchors = NO_ANCHORS
): RequiredScore {
  return solve(extra => subjectAverage(subject, state, extra, anchors), subject.id, target, outOf, coefficient);
}

export function requiredForOverall(
  subjects: Subject[],
  subjectId: string,
  state: SimulationState,
  target: number,
  outOf = 20,
  coefficient = 1,
  anchors: Anchors = NO_ANCHORS
): RequiredScore {
  return solve(extra => overallAverage(subjects, state, extra, anchors), subjectId, target, outOf, coefficient);
}

/** "15,5" / "15.5" / " 15 " → 15.5; NaN when not a number. */
export function parseNumber(input: string): number {
  const value = Number(input.trim().replace(",", "."));
  return input.trim() === "" ? NaN : value;
}

export function formatAverage(value: number, digits = 2): string {
  return value < 0 ? "—" : value.toFixed(digits).replace(".", ",");
}
