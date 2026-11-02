import { getHomeworkRouteId } from "@/database/useHomework";
import { Homework } from "@/services/shared/homework";
import { getVikunjaToken, useVikunjaStore } from "@/stores/vikunja";
import { warn } from "@/utils/logger/logger";
import { getSubjectName } from "@/utils/subjects/name";
import { findSchoolRootProject, matchProjectForSubject, normalizeSubject } from "@/utils/vikunja/match";

import { VikunjaClient, VikunjaProject } from "./api";

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

/** Override › automatic subject match › default project › "Scolaire" › Inbox. */
export function resolveProjectForSubject(subject: string, projects: VikunjaProject[]): VikunjaProject | null {
  const { subjectProjects, defaultProjectId } = useVikunjaStore.getState();
  const byId = (id?: number) => (id ? projects.find(project => project.id === id) ?? null : null);

  return (
    byId(subjectProjects[normalizeSubject(subject)]) ??
    matchProjectForSubject(getSubjectName(subject), projects) ??
    matchProjectForSubject(subject, projects) ??
    byId(defaultProjectId) ??
    findSchoolRootProject(projects) ??
    projects.find(project => project.title.toLowerCase() === "inbox") ??
    projects[0] ??
    null
  );
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

/** Creates the Vikunja task for a homework (once). Returns the task id. */
export async function exportHomeworkToVikunja(homework: Homework): Promise<number> {
  const client = await getVikunjaClient();
  if (!client) {throw new Error("Vikunja n'est pas connecté.");}

  const key = getHomeworkRouteId(homework);
  const existing = useVikunjaStore.getState().exported[key];
  if (existing) {return existing;}

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
  return task.id;
}

/** Mirrors a "done" toggle made in Papillon to the exported Vikunja task. */
export async function mirrorHomeworkCompletion(homework: Homework, done: boolean): Promise<void> {
  const { exported, syncCompletion } = useVikunjaStore.getState();
  const taskId = exported[getHomeworkRouteId(homework)];
  if (!taskId || !syncCompletion) {return;}
  const client = await getVikunjaClient();
  if (!client) {return;}
  try {
    await client.setDone(taskId, done);
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
