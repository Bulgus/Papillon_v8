import { getHomeworkRouteId } from "@/database/useHomework";
import { Homework } from "@/services/shared/homework";
import { getVikunjaToken, useVikunjaStore } from "@/stores/vikunja";
import { warn } from "@/utils/logger/logger";
import { getSubjectName } from "@/utils/subjects/name";
import { cleanSubjectName } from "@/utils/subjects/utils";
import { reconcileCompletion } from "@/utils/vikunja/reconcile";
import { findSchoolRootProject, matchProjectForSubject, normalizeSubject } from "@/utils/vikunja/match";

import { VikunjaClient, VikunjaError, VikunjaProject } from "./api";

let projectsCache: { at: number; baseURL: string; projects: VikunjaProject[] } | null = null;
const PROJECTS_TTL = 5 * 60 * 1000;

export async function getVikunjaClient(): Promise<VikunjaClient | null> {
  const { baseURL, connected } = useVikunjaStore.getState();
  if (!baseURL || !connected) {return null;}
  const token = await getVikunjaToken();
  if (!token) {return null;}
  return new VikunjaClient(baseURL, token);
}

export async function getVikunjaProjects(force = false): Promise<VikunjaProject[]> {
  const client = await getVikunjaClient();
  if (!client) {return [];}
  if (!force && projectsCache && projectsCache.baseURL === client.baseURL && Date.now() - projectsCache.at < PROJECTS_TTL) {
    return projectsCache.projects;
  }
  const projects = await client.getProjects();
  projectsCache = { at: Date.now(), baseURL: client.baseURL, projects };
  return projects;
}

/** Stored in subjectProjects: never send this subject to Vikunja automatically. */
export const SUBJECT_NOT_SYNCED = -1;

/** Key of a subject in the mapping: the same key as the account's subject customisation. */
export const subjectKey = (subject: string) => cleanSubjectName(subject);

export type SubjectProjectSource = "manual" | "auto" | "fallback" | "excluded";

/**
 * Project a subject goes to, and why:
 * manual choice › automatic name match › default project › "Scolaire" › Inbox.
 */
export function resolveSubjectProject(
  subject: string,
  projects: VikunjaProject[]
): { project: VikunjaProject | null; source: SubjectProjectSource } {
  const { subjectProjects, defaultProjectId } = useVikunjaStore.getState();
  const byId = (id?: number) => (id ? projects.find(project => project.id === id) ?? null : null);

  const manual = subjectProjects[subjectKey(subject)] ?? subjectProjects[normalizeSubject(subject)];
  if (manual === SUBJECT_NOT_SYNCED) {return { project: null, source: "excluded" };}
  const chosen = byId(manual);
  if (chosen) {return { project: chosen, source: "manual" };}

  const auto = matchProjectForSubject(getSubjectName(subject), projects) ?? matchProjectForSubject(subject, projects);
  if (auto) {return { project: auto, source: "auto" };}

  const fallback =
    byId(defaultProjectId) ??
    findSchoolRootProject(projects) ??
    projects.find(project => project.title.toLowerCase() === "inbox") ??
    projects[0] ??
    null;
  return { project: fallback, source: "fallback" };
}

/** Where a subject's homework goes; when the subject is excluded, the default project. */
export function resolveProjectForSubject(subject: string, projects: VikunjaProject[]): VikunjaProject | null {
  const resolved = resolveSubjectProject(subject, projects);
  if (resolved.source !== "excluded") {return resolved.project;}
  const { defaultProjectId } = useVikunjaStore.getState();
  return (
    projects.find(project => project.id === defaultProjectId) ??
    findSchoolRootProject(projects) ??
    projects.find(project => project.title.toLowerCase() === "inbox") ??
    projects[0] ??
    null
  );
}

/**
 * Project id → subject key, for the projects a subject was explicitly or
 * automatically matched to (not the fallback ones): lets a Vikunja task wear
 * its subject's name, emoji and colour.
 */
export function projectSubjectMap(subjectKeys: string[], projects: VikunjaProject[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const key of subjectKeys) {
    const { project, source } = resolveSubjectProject(key, projects);
    if (project && (source === "manual" || source === "auto") && !map.has(project.id)) {
      map.set(project.id, key);
    }
  }
  return map;
}

function stripHTML(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#0?39;/g, "'")
    .trim();
}

export function homeworkTaskTitle(homework: Homework): string {
  const text = stripHTML(homework.content).split("\n").map(line => line.trim()).find(Boolean) ?? "";
  const title = text.length > 90 ? `${text.slice(0, 87).trimEnd()}…` : text;
  return title || `Devoir de ${getSubjectName(homework.subject)}`;
}

function homeworkTaskDescription(homework: Homework): string {
  const attachments = homework.attachments
    .filter(attachment => attachment.url)
    .map(attachment => `<li><a href="${attachment.url}">${attachment.name ?? attachment.url}</a></li>`)
    .join("");
  return [
    homework.content.includes("<") ? homework.content : `<p>${homework.content.replace(/\n/g, "<br>")}</p>`,
    attachments ? `<ul>${attachments}</ul>` : "",
    `<p><em>${getSubjectName(homework.subject)}${homework.evaluation ? " · Évaluation" : ""} · ajouté depuis Papillon</em></p>`,
  ].join("");
}

export function isHomeworkExported(homework: Homework): boolean {
  return Boolean(useVikunjaStore.getState().exported[getHomeworkRouteId(homework)]);
}

/** Vikunja task id of a homework, when it is in Vikunja (not deleted there). */
export function exportedTaskId(homework: Homework): number | null {
  const id = useVikunjaStore.getState().exported[getHomeworkRouteId(homework)];
  return id && id > 0 ? id : null;
}

/** Creates the Vikunja task for a homework (once). Returns the task id. */
export async function exportHomeworkToVikunja(homework: Homework): Promise<number> {
  const client = await getVikunjaClient();
  if (!client) {throw new Error("Vikunja n'est pas connecté.");}

  const key = getHomeworkRouteId(homework);
  const existing = useVikunjaStore.getState().exported[key];
  // -1: deleted in Vikunja, a manual export creates it again.
  if (existing && existing > 0) {return existing;}

  const projects = await getVikunjaProjects();
  const project = resolveProjectForSubject(homework.subject, projects);
  if (!project) {throw new Error("Aucun projet Vikunja disponible.");}

  // Due at 08:00 local time on the day the homework is for (before class).
  const due = new Date(homework.dueDate);
  if (due.getHours() === 0 && due.getMinutes() === 0) {due.setHours(8, 0, 0, 0);}

  const task = await client.createTask(project.id, {
    title: homeworkTaskTitle(homework),
    description: homeworkTaskDescription(homework),
    dueDate: due,
    priority: homework.evaluation ? 3 : 0,
  });
  useVikunjaStore.getState().markExported(key, task.id);
  if (homework.isDone) {
    await client.setDone(task.id, true).catch(() => undefined);
  }
  useVikunjaStore.getState().markSynced(key, homework.isDone);
  return task.id;
}

/** Mirrors a "done" toggle made in Papillon to the exported Vikunja task. */
export async function mirrorHomeworkCompletion(homework: Homework, done: boolean): Promise<void> {
  const { syncCompletion } = useVikunjaStore.getState();
  const taskId = exportedTaskId(homework);
  if (!taskId || !syncCompletion) {return;}
  const client = await getVikunjaClient();
  if (!client) {return;}
  try {
    await client.setDone(taskId, done);
    useVikunjaStore.getState().markSynced(getHomeworkRouteId(homework), done);
  } catch (error) {
    warn(`Vikunja completion sync failed: ${String(error)}`);
  }
}

let syncing = false;

/**
 * Auto-sync: pushes upcoming, not-done school homework that is not in
 * Vikunja yet. Safe to call often.
 */
export async function syncHomeworksToVikunja(homeworks: Homework[]): Promise<number> {
  const { autoSync, connected } = useVikunjaStore.getState();
  if (!autoSync || !connected || syncing) {return 0;}
  syncing = true;
  let created = 0;
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const homework of homeworks) {
      if (homework.custom || homework.isDone) {continue;}
      // Subjects the user chose to keep out of Vikunja.
      if (useVikunjaStore.getState().subjectProjects[subjectKey(homework.subject)] === SUBJECT_NOT_SYNCED) {continue;}
      if (new Date(homework.dueDate).getTime() < today.getTime()) {continue;}
      if (isHomeworkExported(homework)) {continue;}
      try {
        await exportHomeworkToVikunja(homework);
        created++;
      } catch (error) {
        warn(`Vikunja export failed: ${String(error)}`);
        break;
      }
    }
    useVikunjaStore.getState().update({ lastSyncAt: Date.now() });
  } finally {
    syncing = false;
  }
  return created;
}

export interface CompletionChange {
  key: string;
  homework: Homework;
  done: boolean;
}

/** Applies a "done" state decided by Vikunja to Papillon and the school service. */
async function applyCompletionToPapillon(homework: Homework, done: boolean): Promise<void> {
  // Lazy: services/shared pulls every school service in.
  const { getManager } = await import("@/services/shared");
  const { updateHomeworkIsDone } = await import("@/database/useHomework");
  if (!homework.custom) {
    await getManager()?.setHomeworkCompletion(homework, done);
  }
  await updateHomeworkIsDone(getHomeworkRouteId(homework), done);
}

let pulling = false;

/**
 * Two-way completion sync for exported homework, Vikunja being the source of
 * truth: a task checked in Vikunja (mDone…) is checked in Papillon and on the
 * school service; a homework checked in Papillon while Vikunja was out of
 * reach is pushed there. Returns what changed in Papillon.
 */
export async function syncCompletionWithVikunja(
  homeworks: Homework[],
  apply: (homework: Homework, done: boolean) => Promise<void> = applyCompletionToPapillon
): Promise<CompletionChange[]> {
  const { syncCompletion, connected } = useVikunjaStore.getState();
  if (!syncCompletion || !connected || pulling) {return [];}
  const client = await getVikunjaClient();
  if (!client) {return [];}

  pulling = true;
  const changes: CompletionChange[] = [];
  try {
    const seen = new Set<string>();
    for (const homework of homeworks) {
      const key = getHomeworkRouteId(homework);
      if (seen.has(key)) {continue;}
      seen.add(key);
      const taskId = exportedTaskId(homework);
      if (!taskId) {continue;}

      let vikunjaDone: boolean;
      try {
        vikunjaDone = Boolean((await client.getTask(taskId)).done);
      } catch (error) {
        if (error instanceof VikunjaError && error.status === 404) {
          // Deleted in Vikunja: keep it out of Vikunja from now on.
          useVikunjaStore.getState().markExported(key, -1);
          continue;
        }
        warn(`Vikunja completion pull failed: ${String(error)}`);
        break;
      }

      const action = reconcileCompletion(Boolean(homework.isDone), vikunjaDone, useVikunjaStore.getState().syncedDone[key]);
      try {
        if (action === "toPapillon") {
          await apply(homework, vikunjaDone);
          changes.push({ key, homework, done: vikunjaDone });
        } else if (action === "toVikunja") {
          await client.setDone(taskId, Boolean(homework.isDone));
        }
        useVikunjaStore.getState().markSynced(key, action === "toPapillon" ? vikunjaDone : Boolean(homework.isDone));
      } catch (error) {
        warn(`Vikunja completion sync failed: ${String(error)}`);
      }
    }
  } finally {
    pulling = false;
  }
  return changes;
}
