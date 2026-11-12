import { GenericInterface } from "@/services/shared/types";

/** One skill assessed in an evaluation (Pronote "compétences"). */
export interface SkillResult {
  id: string;
  /** What is assessed, e.g. "Écouter et comprendre". */
  name: string;
  /** Wider domain, e.g. "LANGUES VIVANTES". */
  domain?: string;
  /** e.g. "A+", "A", "C", "E", "Abs". */
  abbreviation: string;
  /** e.g. "Très bonne maîtrise". */
  level: string;
  coefficient: number;
  order: number;
}

export interface SkillEvaluation extends GenericInterface {
  id: string;
  name: string;
  subject: string;
  teacher: string;
  description: string;
  date: Date;
  coefficient: number;
  skills: SkillResult[];
}

export interface GradebookSubject {
  name: string;
  group?: string;
  coefficient: number;
  studentAverage: number | null;
  classAverage: number | null;
  min: number | null;
  max: number | null;
  appreciation: string;
  teachers: string[];
}

/** Bulletin of a period. */
export interface Gradebook extends GenericInterface {
  periodName: string;
  /** General appreciation, mentions (name → value). */
  overall: { name: string; value: string }[];
  message?: string;
  subjects: GradebookSubject[];
}
