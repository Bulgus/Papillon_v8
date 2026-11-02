/**
 * Small Vikunja REST client (https://vikunja.io/docs/api).
 *
 * Papillon never keeps the user's password: it logs in once, creates a
 * dedicated API token named "Papillon" limited to tasks/projects/labels,
 * and only stores that token.
 */

export interface VikunjaProject {
  id: number;
  title: string;
  parent_project_id: number;
  is_archived: boolean;
  hex_color?: string;
  identifier?: string;
}

export interface VikunjaLabel {
  id: number;
  title: string;
  hex_color?: string;
}

export interface VikunjaTask {
  id: number;
  title: string;
  description: string;
  done: boolean;
  done_at?: string;
  due_date: string | null;
  priority: number;
  project_id: number;
  identifier?: string;
  index?: number;
  hex_color?: string;
  percent_done?: number;
  labels?: VikunjaLabel[] | null;
  created?: string;
  updated?: string;
  [key: string]: unknown;
}

export class VikunjaError extends Error {
  constructor(message: string, public status?: number, public code?: number) {
    super(message);
    this.name = "VikunjaError";
  }
}

export class VikunjaTOTPRequiredError extends VikunjaError {
  constructor() {
    super("Code de double authentification requis.", 412, 1017);
    this.name = "VikunjaTOTPRequiredError";
  }
}

const NULL_DATE = "0001-01-01T00:00:00Z";

/** Vikunja uses the year 1 to say "no date". */
export function parseVikunjaDate(value?: string | null): Date | null {
  if (!value || value.startsWith("0001-01-01")) {return null;}
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function toVikunjaDate(date?: Date | null): string {
  return date ? date.toISOString().replace(/\.\d{3}Z$/, "Z") : NULL_DATE;
}

/**
 * Accepts "vikunja.example.com", "https://vikunja.example.com/",
 * "https://example.com/vikunja/api/v1" … and returns the API base URL.
 */
export function normalizeVikunjaURL(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) {url = `https://${url}`;}
  url = url.replace(/\/+$/, "");
  url = url.replace(/\/api\/v\d+$/i, "");
  return `${url}/api/v1`;
}

export const TOKEN_PERMISSIONS = {
  tasks: ["read_all", "read_one", "create", "update", "delete"],
  projects: ["read_all", "read_one"],
  labels: ["read_all", "read_one"],
};

async function parseError(response: Response): Promise<VikunjaError> {
  let message = `Erreur Vikunja (${response.status})`;
  let code: number | undefined;
  try {
    const body = await response.json();
    if (body?.message) {message = body.message;}
    code = body?.code;
  } catch {
    // not JSON
  }
  if (code === 1017 || /totp/i.test(message)) {
    return new VikunjaTOTPRequiredError();
  }
  if (response.status === 401 || response.status === 403) {
    return new VikunjaError(
      code === 1011 ? "Identifiant ou mot de passe Vikunja incorrect." : message,
      response.status,
      code
    );
  }
  return new VikunjaError(message, response.status, code);
}

async function request<T>(
  baseURL: string,
  path: string,
  token: string | null,
  init: { method?: string; body?: unknown; query?: Record<string, string | number> } = {}
): Promise<T> {
  const qs = init.query
    ? "?" + new URLSearchParams(Object.entries(init.query).map(([k, v]) => [k, String(v)])).toString()
    : "";
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) {headers.Authorization = `Bearer ${token}`;}
  if (init.body !== undefined) {headers["Content-Type"] = "application/json";}

  const response = await fetch(`${baseURL}${path}${qs}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    throw await parseError(response);
  }
  if (response.status === 204) {return undefined as T;}
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * Logs in with username/password (+ optional TOTP) and creates a long-lived
 * API token for Papillon. The password is not kept.
 */
export async function createVikunjaToken(
  serverURL: string,
  username: string,
  password: string,
  totp?: string,
  deviceName = "Papillon"
): Promise<{ baseURL: string; token: string; tokenId?: number; username: string }> {
  const baseURL = normalizeVikunjaURL(serverURL);

  const info = await fetch(`${baseURL}/info`).catch(() => null);
  if (!info || !info.ok) {
    throw new VikunjaError("Serveur Vikunja injoignable. Vérifie l'adresse.");
  }

  const login = await request<{ token: string }>(baseURL, "/login", null, {
    method: "POST",
    body: {
      username: username.trim(),
      password,
      long_token: true,
      ...(totp ? { totp_passcode: totp.trim() } : {}),
    },
  });

  const expires = new Date();
  expires.setFullYear(expires.getFullYear() + 10);

  const created = await request<{ id?: number; token: string }>(baseURL, "/tokens", login.token, {
    method: "PUT",
    body: {
      title: deviceName,
      expires_at: toVikunjaDate(expires),
      permissions: TOKEN_PERMISSIONS,
    },
  });

  const user = await request<{ username: string; name?: string }>(baseURL, "/user", login.token).catch(
    () => ({ username: username.trim(), name: undefined })
  );

  return {
    baseURL,
    token: created.token,
    tokenId: created.id,
    username: user.name || user.username,
  };
}

export class VikunjaClient {
  constructor(public readonly baseURL: string, private readonly token: string) {}

  private req<T>(path: string, init?: Parameters<typeof request>[3]) {
    return request<T>(this.baseURL, path, this.token, init);
  }

  async getProjects(): Promise<VikunjaProject[]> {
    const projects = await this.req<VikunjaProject[]>("/projects", { query: { per_page: 200 } });
    // Negative ids are saved filters ("My Open Tasks"…), not real projects.
    return (projects ?? []).filter(project => project.id > 0 && !project.is_archived);
  }

  /** All tasks matching a Vikunja filter, following pagination. */
  async getTasks(filter = "done = false", maxPages = 10): Promise<VikunjaTask[]> {
    const tasks: VikunjaTask[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const batch = await this.req<VikunjaTask[]>("/tasks", {
        query: { filter, per_page: 50, page, sort_by: "due_date", order_by: "asc" },
      });
      if (!batch?.length) {break;}
      tasks.push(...batch);
      if (batch.length < 50) {break;}
    }
    return tasks;
  }

  async getOpenTasks(): Promise<VikunjaTask[]> {
    return this.getTasks("done = false");
  }

  async getTask(id: number): Promise<VikunjaTask> {
    return this.req<VikunjaTask>(`/tasks/${id}`);
  }

  async createTask(
    projectId: number,
    task: { title: string; description?: string; dueDate?: Date | null; priority?: number }
  ): Promise<VikunjaTask> {
    return this.req<VikunjaTask>(`/projects/${projectId}/tasks`, {
      method: "PUT",
      body: {
        title: task.title,
        description: task.description ?? "",
        due_date: toVikunjaDate(task.dueDate),
        priority: task.priority ?? 0,
        project_id: projectId,
      },
    });
  }

  /**
   * Vikunja replaces the whole task on update, so the current task is read
   * first and only the given fields are changed.
   */
  async updateTask(id: number, changes: Partial<VikunjaTask>): Promise<VikunjaTask> {
    const current = await this.getTask(id);
    return this.req<VikunjaTask>(`/tasks/${id}`, {
      method: "POST",
      body: { ...current, ...changes },
    });
  }

  async setDone(id: number, done: boolean): Promise<VikunjaTask> {
    return this.updateTask(id, { done });
  }

  async deleteTask(id: number): Promise<void> {
    await this.req(`/tasks/${id}`, { method: "DELETE" });
  }
}
