import type { Grade } from "@/services/shared/grade";

/**
 * Identity of a grade across sessions. Not its id: Pronote hands out new ids
 * at every login, which made every grade look new on each check.
 */
export const gradeKey = (grade: Grade) =>
  [
    grade.subjectName,
    grade.description,
    grade.givenAt ? new Date(grade.givenAt).toDateString() : "",
    grade.studentScore?.disabled ? grade.studentScore?.status ?? "" : grade.studentScore?.value ?? "",
    grade.outOf?.value ?? "",
    grade.coefficient ?? "",
  ].join("|");
