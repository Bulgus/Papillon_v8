import type { SkillEvaluation, SkillResult } from "@/services/shared/evaluation";

export interface SkillLevel {
  /** 4 = très bonne maîtrise … 1 = insuffisante; null = not assessed (absent, dispensé…). */
  score: 4 | 3 | 2 | 1 | null;
  color: string;
  label: string;
}

export const LEVELS: Record<4 | 3 | 2 | 1, { color: string; label: string }> = {
  4: { color: "#1B8A3A", label: "Très bonne maîtrise" },
  3: { color: "#5CB85C", label: "Maîtrise satisfaisante" },
  2: { color: "#F0A202", label: "Maîtrise fragile" },
  1: { color: "#D93B3B", label: "Maîtrise insuffisante" },
};

const NOT_ASSESSED = { score: null, color: "#8E8E93", label: "Non évalué" } as const;

const normalize = (value: string) =>
  value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/**
 * Level of a skill. Pronote lets schools rename levels, so the wording is
 * read first, then the usual abbreviations (A+, A, B/C, D/E or V+, V, J, R…).
 */
export function skillLevel(skill: Pick<SkillResult, "abbreviation" | "level">): SkillLevel {
  const level = normalize(skill.level ?? "");
  const abbreviation = (skill.abbreviation ?? "").trim().toUpperCase();

  let score: 4 | 3 | 2 | 1 | null = null;
  if (/tres bonne|expert|depasse/.test(level)) {score = 4;}
  else if (/satisfaisant|maitrise$|^maitrise|atteint|acquis$|^acquis/.test(level) && !/non|insuff|fragile|partiel|en cours/.test(level)) {score = 3;}
  else if (/fragile|partiel|en cours|presque/.test(level)) {score = 2;}
  else if (/insuffisant|non (acquis|atteint|maitris)|debut/.test(level)) {score = 1;}
  else if (/absent|dispens|non evalue|non rendu/.test(level)) {score = null;}
  else {
    const byAbbreviation: Record<string, 4 | 3 | 2 | 1> = {
      "A+": 4, "V+": 4, "TB": 4,
      "A": 3, "V": 3, "S": 3,
      "B": 2, "C": 2, "J": 2, "F": 2,
      "D": 1, "E": 1, "R": 1, "I": 1,
    };
    score = byAbbreviation[abbreviation] ?? null;
  }

  if (score === null) {return { ...NOT_ASSESSED, label: skill.level || NOT_ASSESSED.label };}
  return { score, color: LEVELS[score].color, label: skill.level || LEVELS[score].label };
}

export interface SkillsSummary {
  /** Assessed skills per score (4 → 1). */
  counts: Record<4 | 3 | 2 | 1, number>;
  assessed: number;
  /** 0–100: mean score over 4, weighted by skill coefficient. null when nothing assessed. */
  mastery: number | null;
}

export function summarizeSkills(evaluations: SkillEvaluation[]): SkillsSummary {
  const counts: Record<4 | 3 | 2 | 1, number> = { 4: 0, 3: 0, 2: 0, 1: 0 };
  let weighted = 0;
  let weights = 0;
  for (const evaluation of evaluations) {
    for (const skill of evaluation.skills) {
      const { score } = skillLevel(skill);
      if (score === null) {continue;}
      counts[score]++;
      const weight = skill.coefficient > 0 ? skill.coefficient : 1;
      weighted += score * weight;
      weights += weight;
    }
  }
  const assessed = counts[4] + counts[3] + counts[2] + counts[1];
  return {
    counts,
    assessed,
    mastery: weights > 0 ? Math.round(((weighted / weights - 1) / 3) * 100) : null,
  };
}

/** Evaluations grouped by subject, subjects sorted by name, newest first inside. */
export function groupBySubject(evaluations: SkillEvaluation[]): Array<{ subject: string; evaluations: SkillEvaluation[] }> {
  const groups = new Map<string, SkillEvaluation[]>();
  for (const evaluation of evaluations) {
    const list = groups.get(evaluation.subject) ?? [];
    list.push(evaluation);
    groups.set(evaluation.subject, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "fr"))
    .map(([subject, list]) => ({
      subject,
      evaluations: [...list].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()),
    }));
}
