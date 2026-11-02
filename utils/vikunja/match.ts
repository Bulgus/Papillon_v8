import type { VikunjaProject } from "@/services/vikunja/api";

const STOP_WORDS = new Set(["de", "du", "des", "la", "le", "les", "et", "en", "l", "d", "a", "au", "aux", "sc", "ens", "lv1", "lv2", "lva", "lvb"]);

// Common school abbreviations, written the way Pronote/ED spell subjects.
const ALIASES: Record<string, string[]> = {
  hggsp: ["histoire geographie geopolitique sciences politiques", "hist geo geopol sc pol", "hist geo geopol"],
  ses: ["sciences economiques sociales", "sc econo sociales"],
  es: ["enseignement scientifique", "enseign scientifique"],
  emc: ["enseignement moral civique", "ens moral civique", "education morale civique"],
  edc: ["enseignement moral civique", "education civique", "emc"],
  svt: ["sciences vie terre"],
  "physique chimie": ["physique chimie", "phys chimie", "sciences physiques"],
  nsi: ["numerique sciences informatiques"],
  hlp: ["humanites litterature philosophie"],
  llcer: ["langues litteratures cultures etrangeres"],
  eps: ["education physique sportive"],
  "histoire geographie": ["histoire geo", "hist geo"],
  maths: ["mathematiques"],
  philo: ["philosophie"],
  anglais: ["anglais lv1", "anglais lv2", "langue vivante anglais"],
};

export function normalizeSubject(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function words(value: string): string[] {
  return normalizeSubject(value).split(" ").filter(word => word && !STOP_WORDS.has(word));
}

function acronym(value: string): string {
  return words(value).map(word => word[0]).join("");
}

function expansions(value: string): string[] {
  const normalized = normalizeSubject(value);
  const result = new Set([normalized]);
  for (const [key, list] of Object.entries(ALIASES)) {
    if (key === normalized || list.includes(normalized)) {
      result.add(key);
      list.forEach(item => result.add(item));
    }
  }
  return [...result];
}

/** Every word of `short` is a prefix of a word of `long`, in order ("hist geo" ⊂ "histoire geographie"). */
function prefixCovers(short: string[], long: string[]): boolean {
  if (short.length === 0 || short.length > long.length) {return false;}
  let index = 0;
  for (const word of long) {
    if (index < short.length && word.startsWith(short[index]) && short[index].length >= 3) {
      index++;
    }
  }
  return index === short.length;
}

function score(subject: string, project: string): number {
  let best = 0;
  const rawProject = normalizeSubject(project);
  for (const s of expansions(subject)) {
    for (const p of expansions(project)) {
      if (s === p) {return 100;}
      // Fuzzy matching only against what the user actually typed, not aliases.
      if (p !== rawProject) {continue;}
      const sw = words(s);
      const pw = words(p);
      if (sw.join(" ") === pw.join(" ")) {best = Math.max(best, 95);}
      if (pw.length === 1 && pw[0].length >= 2 && acronym(s) === pw[0]) {best = Math.max(best, 85);}
      if (sw.length === 1 && sw[0].length >= 2 && acronym(p) === sw[0]) {best = Math.max(best, 85);}
      // The closer the two lengths, the better: "Histoire" beats "HGGSP" for "Histoire-Géographie".
      if (prefixCovers(sw, pw)) {best = Math.max(best, 70 + Math.round(20 * sw.length / pw.length));}
      if (prefixCovers(pw, sw)) {best = Math.max(best, 70 + Math.round(20 * pw.length / sw.length));}
    }
  }
  return best;
}

const SCHOOL_ROOTS = ["scolaire", "ecole", "cours", "lycee", "college", "fac", "universite", "devoirs", "school", "homework"];

/**
 * Finds the project that matches a school subject. Sub-projects of a
 * "Scolaire"/"Cours"/… project win ties.
 */
export function matchProjectForSubject(subject: string, projects: VikunjaProject[]): VikunjaProject | null {
  const schoolRoots = new Set(
    projects.filter(project => SCHOOL_ROOTS.includes(normalizeSubject(project.title))).map(project => project.id)
  );
  let best: { project: VikunjaProject; score: number } | null = null;
  for (const project of projects) {
    let value = score(subject, project.title);
    if (value === 0) {continue;}
    if (schoolRoots.has(project.parent_project_id)) {value += 5;}
    if (!best || value > best.score) {best = { project, score: value };}
  }
  return best && best.score >= 70 ? best.project : null;
}

/** "Scolaire" (or similar) when it exists, otherwise null. */
export function findSchoolRootProject(projects: VikunjaProject[]): VikunjaProject | null {
  return projects.find(project => SCHOOL_ROOTS.includes(normalizeSubject(project.title))) ?? null;
}
