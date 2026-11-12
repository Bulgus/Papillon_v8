import type { GradebookSubject } from "@/services/shared/evaluation";

export function formatGradebookAverage(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {return "—";}
  return value.toFixed(2).replace(".", ",");
}

/** Subjects by bulletin group ("Enseignements communs", "Spécialités"…), in bulletin order. */
export function groupGradebookSubjects(subjects: GradebookSubject[]): Array<{ name: string; subjects: GradebookSubject[] }> {
  const groups: Array<{ name: string; subjects: GradebookSubject[] }> = [];
  for (const subject of subjects) {
    const name = subject.group ?? "";
    let group = groups.find(item => item.name === name);
    if (!group) {
      group = { name, subjects: [] };
      groups.push(group);
    }
    group.subjects.push(subject);
  }
  return groups;
}
