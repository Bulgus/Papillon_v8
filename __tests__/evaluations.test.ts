import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/utils/logger/logger", () => ({
  error: (message: string) => new Error(message),
  warn: jest.fn(),
  log: jest.fn(),
}));

import { reviveDates } from "@/database/useReports";
import { mapPronoteEvaluation, mapPronoteGradebook, mapPronotePeriods } from "@/services/pronote/evaluations";
import { SkillEvaluation } from "@/services/shared/evaluation";
import { formatGradebookAverage, groupGradebookSubjects } from "@/utils/evaluations/gradebook";
import { groupBySubject, skillLevel, summarizeSkills } from "@/utils/evaluations/levels";

const pawnoteSkill = (order: number, abbreviation: string, level: string, extra: Record<string, unknown> = {}) => ({
  id: `skill-${order}`,
  order,
  level,
  abbreviation,
  coefficient: 1,
  domainID: "d",
  domainName: "Écouter et comprendre",
  pillarID: "p",
  pillarName: "LANGUES VIVANTES",
  pillarPrefixes: ["D1.2"],
  ...extra,
});

describe("evaluations: Pronote mapping", () => {
  it("maps an evaluation with its skills in order", () => {
    const evaluation = mapPronoteEvaluation(
      {
        name: "Compréhension orale",
        id: "e1",
        teacher: "M. Smith",
        coefficient: 1,
        description: "Unit 3",
        subject: { id: "s", name: "ANGLAIS LV1", inGroups: false },
        levels: ["Cycle 4"],
        date: new Date("2026-10-02"),
        skills: [
          pawnoteSkill(2, "A", "Maîtrise satisfaisante"),
          pawnoteSkill(1, "A+", "Très bonne maîtrise", { itemName: "Repérer des indices sonores" }),
        ],
      } as never,
      "acc"
    );
    expect(evaluation).toMatchObject({ id: "e1", subject: "ANGLAIS LV1", teacher: "M. Smith", createdByAccount: "acc" });
    expect(evaluation.skills.map(skill => skill.abbreviation)).toEqual(["A+", "A"]);
    // The item is what is assessed; the domain becomes its context.
    expect(evaluation.skills[0]).toMatchObject({ name: "Repérer des indices sonores", domain: "Écouter et comprendre" });
    expect(evaluation.skills[1]).toMatchObject({ name: "Écouter et comprendre", domain: "LANGUES VIVANTES" });
  });

  it("maps a bulletin, dropping empty assessments and missing averages", () => {
    const book = mapPronoteGradebook(
      {
        url: "x",
        overallAssessments: [
          { name: "Appréciation générale", value: "Bon trimestre." },
          { name: "Mention", value: "  " },
        ],
        subjects: [
          {
            subject: { id: "m", name: "MATHEMATIQUES", inGroups: false },
            subjectGroup: "Enseignements communs",
            coef: 1,
            averages: { student: 15.5, classOverall: 12.1, max: 19, min: -1 },
            assessments: ["Très bon travail.", ""],
            teachers: ["M. Euler"],
          },
        ],
      } as never,
      "Trimestre 1",
      "acc"
    );
    expect(book.overall).toEqual([{ name: "Appréciation générale", value: "Bon trimestre." }]);
    expect(book.subjects[0]).toMatchObject({
      name: "MATHEMATIQUES",
      group: "Enseignements communs",
      studentAverage: 15.5,
      min: null,
      appreciation: "Très bon travail.",
    });
  });

  it("maps periods", () => {
    const start = new Date("2026-09-01");
    const end = new Date("2026-11-30");
    expect(mapPronotePeriods([{ id: "1", name: "Trimestre 1", kind: 1, startDate: start, endDate: end }] as never, "acc")).toEqual([
      { id: "1", name: "Trimestre 1", start, end, createdByAccount: "acc" },
    ]);
  });
});

describe("evaluations: skill levels", () => {
  it.each([
    ["A+", "Très bonne maîtrise", 4],
    ["A", "Maîtrise satisfaisante", 3],
    ["C", "Maîtrise fragile", 2],
    ["E", "Maîtrise insuffisante", 1],
    ["Abs", "Absent", null],
    ["V+", "", 4],
    ["J", "", 2],
    ["R", "", 1],
    ["?", "Niveau inconnu", null],
  ] as const)("%s / %s → %s", (abbreviation, level, score) => {
    expect(skillLevel({ abbreviation, level }).score).toBe(score);
  });

  const evaluation = (subject: string, date: string, skills: Array<[string, string, number?]>): SkillEvaluation => ({
    id: `${subject}-${date}`,
    name: "",
    subject,
    teacher: "",
    description: "",
    date: new Date(date),
    coefficient: 1,
    createdByAccount: "acc",
    skills: skills.map(([abbreviation, level, coefficient = 1], order) => ({ id: String(order), name: "", abbreviation, level, coefficient, order })),
  });

  it("summarises mastery, weighted, ignoring unassessed skills", () => {
    const summary = summarizeSkills([
      evaluation("MATHS", "2026-10-01", [["A+", "Très bonne maîtrise"], ["E", "Maîtrise insuffisante"]]),
      evaluation("SVT", "2026-10-02", [["Abs", "Absent"]]),
    ]);
    expect(summary.assessed).toBe(2);
    expect(summary.counts).toEqual({ 4: 1, 3: 0, 2: 0, 1: 1 });
    expect(summary.mastery).toBe(50);
    expect(summarizeSkills([evaluation("X", "2026-10-01", [["A+", "", 3], ["E", "", 1]])]).mastery).toBe(75);
    expect(summarizeSkills([]).mastery).toBeNull();
  });

  it("groups by subject, newest first", () => {
    const groups = groupBySubject([
      evaluation("SVT", "2026-10-01", []),
      evaluation("Anglais", "2026-09-01", []),
      evaluation("Anglais", "2026-10-05", []),
    ]);
    expect(groups.map(group => group.subject)).toEqual(["Anglais", "SVT"]);
    expect(groups[0].evaluations.map(item => item.date.getMonth())).toEqual([9, 8]);
  });
});

describe("bulletin helpers", () => {
  it("formats averages the French way", () => {
    expect(formatGradebookAverage(15.5)).toBe("15,50");
    expect(formatGradebookAverage(null)).toBe("—");
  });

  it("keeps the bulletin's group order", () => {
    const subject = (name: string, group?: string) => ({ name, group, coefficient: 1, studentAverage: null, classAverage: null, min: null, max: null, appreciation: "", teachers: [] });
    const groups = groupGradebookSubjects([subject("Français", "Communs"), subject("SES", "Spécialités"), subject("Maths", "Communs"), subject("Option")]);
    expect(groups.map(group => [group.name, group.subjects.map(s => s.name)])).toEqual([
      ["Communs", ["Français", "Maths"]],
      ["Spécialités", ["SES"]],
      ["", ["Option"]],
    ]);
  });

  it("revives dates from the offline cache", () => {
    const value = reviveDates<{ date: Date; label: string }>(JSON.stringify({ date: new Date("2026-11-12T08:00:00.000Z"), label: "2026" }));
    expect(value.date).toBeInstanceOf(Date);
    expect(value.label).toBe("2026");
  });
});
