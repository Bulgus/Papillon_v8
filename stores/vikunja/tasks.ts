import { create } from "zustand";

import { Homework } from "@/services/shared/homework";
import { getVikunjaClient, getVikunjaProjects, projectSubjectMap } from "@/services/vikunja";
import { parseVikunjaDate, VikunjaProject, VikunjaTask } from "@/services/vikunja/api";
import { useAccountStore } from "@/stores/account";
import { useVikunjaStore } from "@/stores/vikunja";
import { warn } from "@/utils/logger/logger";

/**
 * Vikunja tasks shown in the Tasks tab, next to the homework. In memory only:
 * Vikunja is the source of truth and is re-read when the tab is opened.
 */
interface VikunjaTasksState {
  tasks: VikunjaTask[];
  projects: VikunjaProject[];
  /** Tasks ticked from Papillon since the last refresh, kept visible as done. */
  doneLocally: Record<number, boolean>;
  loading: boolean;
  lastRefresh?: number;
  error?: string;
  refresh: (force?: boolean) => Promise<void>;
  setDone: (taskId: number, done: boolean) => Promise<void>;
  create: (projectId: number, data: { title: string; description?: string; dueDate?: Date | null }) => Promise<VikunjaTask | null>;
  remove: (taskId: number) => Promise<void>;
}

const REFRESH_EVERY = 60 * 1000;

export const useVikunjaTasksStore = create<VikunjaTasksState>()((set, get) => ({
  tasks: [],
  projects: [],
  doneLocally: {},
  loading: false,

  refresh: async (force = false) => {
    const { loading, lastRefresh } = get();
    if (loading || (!force && lastRefresh && Date.now() - lastRefresh < REFRESH_EVERY)) {return;}
    const client = await getVikunjaClient();
    if (!client) {
      set({ tasks: [], projects: [], doneLocally: {} });
      return;
    }
    set({ loading: true });
    try {
      const [tasks, projects] = await Promise.all([client.getOpenTasks(), getVikunjaProjects(force)]);
      set({ tasks, projects, doneLocally: {}, lastRefresh: Date.now(), error: undefined });
    } catch (error) {
      warn(`Vikunja tasks refresh failed: ${String(error)}`);
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ loading: false });
    }
  },

  setDone: async (taskId, done) => {
    set(state => ({ doneLocally: { ...state.doneLocally, [taskId]: done } }));
    try {
      const client = await getVikunjaClient();
      if (!client) {throw new Error("Vikunja n'est pas connecté.");}
      await client.setDone(taskId, done);
    } catch (error) {
      set(state => {
        const doneLocally = { ...state.doneLocally };
        delete doneLocally[taskId];
        return { doneLocally };
      });
      throw error;
    }
  },

  create: async (projectId, data) => {
    const client = await getVikunjaClient();
    if (!client) {return null;}
    const task = await client.createTask(projectId, data);
    set(state => ({ tasks: [...state.tasks, task] }));
    return task;
  },

  remove: async taskId => {
    const client = await getVikunjaClient();
    if (!client) {return;}
    await client.deleteTask(taskId);
    set(state => ({ tasks: state.tasks.filter(task => task.id !== taskId) }));
  },
}));

const htmlToText = (html: string) =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\n{2,}/g, "\n")
    .trim();

/** Turns Vikunja tasks into homework-shaped items for the week lists. */
export function vikunjaTasksAsHomework(
  tasks: VikunjaTask[],
  projects: VikunjaProject[],
  doneLocally: Record<number, boolean>,
  currentWeekStart: Date
): Homework[] {
  const { exported } = useVikunjaStore.getState();
  // Tasks created from a homework are already shown as that homework.
  const fromHomework = new Set(Object.values(exported));

  const accounts = useAccountStore.getState().accounts;
  const account = accounts.find(item => item.id === useAccountStore.getState().lastUsedAccount);
  const subjectKeys = Object.keys(account?.customisation?.subjects ?? {});
  const bySubject = projectSubjectMap(subjectKeys, projects);
  const byId = new Map(projects.map(project => [project.id, project]));

  const pathOf = (id: number) => {
    const project = byId.get(id);
    if (!project) {return "Vikunja";}
    const parent = byId.get(project.parent_project_id);
    return parent ? `${parent.title} › ${project.title}` : project.title;
  };

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  return tasks
    .filter(task => !fromHomework.has(task.id))
    .map(task => {
      const due = parseVikunjaDate(task.due_date);
      const project = byId.get(task.project_id);
      const hex = (task.hex_color || project?.hex_color || "").replace("#", "");
      const notes = htmlToText(task.description ?? "");
      return {
        id: `vikunja:${task.id}`,
        subject: bySubject.get(task.project_id) ?? project?.title ?? "Vikunja",
        content: notes ? `${task.title}\n${notes.split("\n")[0]}` : task.title,
        dueDate: due ?? startOfToday,
        isDone: doneLocally[task.id] ?? task.done,
        attachments: [],
        evaluation: task.priority >= 3,
        custom: false,
        createdByAccount: "vikunja",
        vikunja: {
          taskId: task.id,
          projectId: task.project_id,
          projectPath: pathOf(task.project_id),
          color: hex.length === 6 ? `#${hex}` : undefined,
          subjectKey: bySubject.get(task.project_id),
          overdue: Boolean(due && due.getTime() < currentWeekStart.getTime()),
          undated: !due,
        },
      } satisfies Homework;
    });
}
