import { Grade, Subject } from "@/services/shared/grade";

import { getSubjectAverage } from "./algorithms/subject";

/**
 * Grade simulator: "what if" grades, excluded grades, and the score needed
 * to reach a target. Averages are on /20 and use Papillon's own method
 * (the overall average is the mean of the subject averages), so they are an
 * estimate: the report card may weight subjects differently.
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

/** -1 when the subject has no usable grade. */
export function subjectAverage(subject: Subject, state: SimulationState, extra: SimulatedGrade[] = []): number {
  return getSubjectAverage(simulatedGradesFor(subject, state, extra));
}

/** Mean of the subject averages, -1 when nothing counts. */
export function overallAverage(subjects: Subject[], state: SimulationState, extra: SimulatedGrade[] = []): number {
  let total = 0;
  let count = 0;
  for (const subject of subjects) {
    const average = subjectAverage(subject, state, extra);
    if (average !== -1) {
      total += average;
      count++;
    }
  }
  return count > 0 ? total / count : -1;
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
  coefficient = 1
): RequiredScore {
  return solve(extra => subjectAverage(subject, state, extra), subject.id, target, outOf, coefficient);
}

export function requiredForOverall(
  subjects: Subject[],
  subjectId: string,
  state: SimulationState,
  target: number,
  outOf = 20,
  coefficient = 1
): RequiredScore {
  return solve(extra => overallAverage(subjects, state, extra), subjectId, target, outOf, coefficient);
}

/** "15,5" / "15.5" / " 15 " → 15.5; NaN when not a number. */
export function parseNumber(input: string): number {
  const value = Number(input.trim().replace(",", "."));
  return input.trim() === "" ? NaN : value;
}

export function formatAverage(value: number, digits = 2): string {
  return value < 0 ? "—" : value.toFixed(digits).replace(".", ",");
}
