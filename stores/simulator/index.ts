import { create } from "zustand";

import { Subject } from "@/services/shared/grade";
import { Anchors, NO_ANCHORS, SimulatedGrade } from "@/utils/grades/simulator";

/**
 * In-memory state of the grade simulator, shared by its overview and its
 * per-subject screen. Never persisted: a simulation is a scratch pad.
 */
interface SimulatorState {
  periodKey: string | null;
  periodName: string;
  subjects: Subject[];
  anchors: Anchors;
  simulated: SimulatedGrade[];
  excluded: string[];

  load: (periodKey: string, periodName: string, subjects: Subject[], anchors: Anchors) => void;
  add: (grade: Omit<SimulatedGrade, "id">) => void;
  remove: (id: string) => void;
  toggleExcluded: (key: string) => void;
  resetSubject: (subjectId: string, keysOfSubject: string[]) => void;
  reset: () => void;
}

let counter = 0;

export const useSimulatorStore = create<SimulatorState>()(set => ({
  periodKey: null,
  periodName: "",
  subjects: [],
  anchors: NO_ANCHORS,
  simulated: [],
  excluded: [],

  load: (periodKey, periodName, subjects, anchors) =>
    set(state =>
      state.periodKey === periodKey
        ? { periodName, subjects, anchors }
        : { periodKey, periodName, subjects, anchors, simulated: [], excluded: [] }
    ),
  add: grade => set(state => ({ simulated: [...state.simulated, { ...grade, id: `sim-${++counter}` }] })),
  remove: id => set(state => ({ simulated: state.simulated.filter(item => item.id !== id) })),
  toggleExcluded: key =>
    set(state => ({
      excluded: state.excluded.includes(key)
        ? state.excluded.filter(item => item !== key)
        : [...state.excluded, key],
    })),
  resetSubject: (subjectId, keysOfSubject) =>
    set(state => ({
      simulated: state.simulated.filter(item => item.subjectId !== subjectId),
      excluded: state.excluded.filter(key => !keysOfSubject.includes(key)),
    })),
  reset: () => set({ simulated: [], excluded: [] }),
}));
