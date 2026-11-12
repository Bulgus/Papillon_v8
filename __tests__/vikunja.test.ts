import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/database/useHomework", () => ({
  getHomeworkRouteId: (homework: { subject: string; content: string; dueDate: Date }) =>
    `${homework.subject}|${homework.content}|${new Date(homework.dueDate).toDateString()}`,
}));
jest.mock("@/utils/subjects/name", () => ({
  getSubjectName: (subject: string) => subject,
  cleanSubjectName: (subject: string) => subject.toLowerCase().trim(),
}));
jest.mock("@/utils/logger/logger", () => ({ warn: jest.fn(), log: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }));

import { Homework } from "@/services/shared/homework";
import {
  normalizeVikunjaURL,
  parseVikunjaDate,
  toVikunjaDate,
  VikunjaClient,
  VikunjaError,
  VikunjaProject,
  VikunjaTOTPRequiredError,
} from "@/services/vikunja/api";
import {
  exportHomeworkToVikunja,
  homeworkTaskTitle,
  projectSubjectMap,
  resolveProjectForSubject,
  resolveSubjectProject,
  SUBJECT_NOT_SYNCED,
  syncCompletionWithVikunja,
  syncHomeworksToVikunja,
} from "@/services/vikunja";
import { useVikunjaStore } from "@/stores/vikunja";
import { findSchoolRootProject, matchProjectForSubject, normalizeSubject } from "@/utils/vikunja/match";
import { reconcileCompletion } from "@/utils/vikunja/reconcile";

const project = (id: number, title: string, parent = 0): VikunjaProject => ({
  id,
  title,
  parent_project_id: parent,
  is_archived: false,
});

const PROJECTS = [
  project(1, "Inbox"),
  project(2, "Scolaire"),
  project(3, "Maths", 2),
  project(4, "Histoire-Géo", 2),
  project(5, "HGGSP", 2),
  project(6, "SES", 2),
  project(7, "Anglais", 2),
  project(8, "Courses"),
];

describe("vikunja: subject ↔ project matching", () => {
  it("normalises accents and punctuation", () => {
    expect(normalizeSubject("Histoire-Géographie & EMC")).toBe("histoire geographie emc");
  });

  it.each([
    ["MATHEMATIQUES", 3],
    ["HISTOIRE-GEOGRAPHIE", 4],
    ["HIST.GEO.GEOPOL.SC.POL.", 5],
    ["SC. ECONO.& SOCIALES", 6],
    ["ANGLAIS LV1", 7],
  ])("matches %s", (subject, id) => {
    expect(matchProjectForSubject(subject, PROJECTS)?.id).toBe(id);
  });

  it("returns null when nothing is close", () => {
    expect(matchProjectForSubject("PHILOSOPHIE", PROJECTS)).toBeNull();
  });

  it("finds the school root project", () => {
    expect(findSchoolRootProject(PROJECTS)?.id).toBe(2);
    expect(findSchoolRootProject([project(1, "Inbox")])).toBeNull();
  });
});

describe("vikunja: API helpers", () => {
  it("normalises server URLs", () => {
    expect(normalizeVikunjaURL("vikunja.example.com")).toBe("https://vikunja.example.com/api/v1");
    expect(normalizeVikunjaURL("https://example.com/vikunja/api/v1/")).toBe("https://example.com/vikunja/api/v1");
    expect(normalizeVikunjaURL(" http://10.0.0.2:3456 ")).toBe("http://10.0.0.2:3456/api/v1");
  });

  it("treats the year 1 as no date", () => {
    expect(parseVikunjaDate("0001-01-01T00:00:00Z")).toBeNull();
    expect(parseVikunjaDate(null)).toBeNull();
    expect(parseVikunjaDate("2026-11-12T08:00:00Z")?.toISOString()).toBe("2026-11-12T08:00:00.000Z");
    expect(toVikunjaDate(null)).toBe("0001-01-01T00:00:00Z");
    expect(toVikunjaDate(new Date("2026-11-12T08:00:00.000Z"))).toBe("2026-11-12T08:00:00Z");
  });
});

describe("vikunja: client", () => {
  const fetchMock = jest.fn<typeof fetch>();
  const json = (body: unknown, status = 200) =>
    ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it("sends the token and drops saved filters and archived projects", async () => {
    fetchMock.mockResolvedValue(json([project(-1, "Filtre"), project(3, "Maths"), { ...project(9, "Old"), is_archived: true }]));
    const projects = await new VikunjaClient("https://v/api/v1", "tok").getProjects();
    expect(projects.map(p => p.id)).toEqual([3]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/projects?per_page=200");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("follows pagination", async () => {
    const page = (n: number, count: number) => Array.from({ length: count }, (_, i) => ({ id: n * 100 + i }));
    fetchMock.mockResolvedValueOnce(json(page(1, 50))).mockResolvedValueOnce(json(page(2, 3)));
    const tasks = await new VikunjaClient("https://v/api/v1", "tok").getTasks();
    expect(tasks).toHaveLength(53);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("updates a task from its current state (Vikunja replaces the whole task)", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 5, title: "T", done: false, priority: 2 }))
      .mockResolvedValueOnce(json({ id: 5, title: "T", done: true, priority: 2 }));
    await new VikunjaClient("https://v/api/v1", "tok").setDone(5, true);
    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(body).toEqual({ id: 5, title: "T", done: true, priority: 2 });
    expect(fetchMock.mock.calls[1][1]?.method).toBe("POST");
  });

  it("maps errors", async () => {
    fetchMock.mockResolvedValueOnce(json({ message: "nope", code: 3 }, 404));
    await expect(new VikunjaClient("https://v/api/v1", "tok").getTask(1)).rejects.toMatchObject({ status: 404, message: "nope" });
    fetchMock.mockResolvedValueOnce(json({ message: "totp", code: 1017 }, 412));
    await expect(new VikunjaClient("https://v/api/v1", "tok").getTask(1)).rejects.toBeInstanceOf(VikunjaTOTPRequiredError);
  });
});

describe("vikunja: completion reconciliation", () => {
  it.each([
    [true, true, undefined, "none"],
    [false, true, false, "toPapillon"], // checked in Vikunja
    [true, false, true, "toPapillon"], // unchecked in Vikunja
    [true, false, false, "toVikunja"], // checked in Papillon, Vikunja not updated
    [false, true, true, "toVikunja"], // unchecked in Papillon
    [true, false, undefined, "toPapillon"], // unknown history: Vikunja wins
  ] as const)("papillon=%s vikunja=%s last=%s → %s", (papillon, vikunja, last, expected) => {
    expect(reconcileCompletion(papillon, vikunja, last)).toBe(expected);
  });
});

const homework = (subject: string, content: string, isDone = false, days = 2): Homework => {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + days);
  dueDate.setHours(0, 0, 0, 0);
  return { subject, content, dueDate, isDone, attachments: [], evaluation: false, custom: false, createdByAccount: "acc" } as unknown as Homework;
};

describe("vikunja: sync with the store", () => {
  const fetchMock = jest.fn<typeof fetch>();
  const json = (body: unknown, status = 200) =>
    ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) }) as Response;

  beforeEach(async () => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
    await useVikunjaStore.getState().disconnect();
    await useVikunjaStore.getState().connect({ baseURL: "https://v/api/v1", token: "tok" });
  });

  it("resolves projects: manual › auto › fallback, and excluded subjects", () => {
    useVikunjaStore.getState().update({ subjectProjects: { "physique": 6, "eps": SUBJECT_NOT_SYNCED } });
    expect(resolveSubjectProject("PHYSIQUE", PROJECTS)).toMatchObject({ source: "manual", project: { id: 6 } });
    expect(resolveSubjectProject("MATHEMATIQUES", PROJECTS)).toMatchObject({ source: "auto", project: { id: 3 } });
    expect(resolveSubjectProject("PHILOSOPHIE", PROJECTS)).toMatchObject({ source: "fallback", project: { id: 2 } });
    expect(resolveSubjectProject("EPS", PROJECTS)).toEqual({ source: "excluded", project: null });
    // An excluded subject still goes somewhere when exported by hand.
    expect(resolveProjectForSubject("EPS", PROJECTS)?.id).toBe(2);
    useVikunjaStore.getState().update({ defaultProjectId: 8 });
    expect(resolveSubjectProject("PHILOSOPHIE", PROJECTS).project?.id).toBe(8);
  });

  it("maps projects back to subjects, without fallbacks", () => {
    const map = projectSubjectMap(["mathematiques", "philosophie"], PROJECTS);
    expect(map.get(3)).toBe("mathematiques");
    expect([...map.values()]).not.toContain("philosophie");
  });

  it("titles a task from the first line of the homework", () => {
    expect(homeworkTaskTitle(homework("MATHS", "<p>Exercices 3 et 4</p><p>page 12</p>"))).toBe("Exercices 3 et 4");
    expect(homeworkTaskTitle(homework("MATHS", ""))).toBe("Devoir de MATHS");
    expect(homeworkTaskTitle(homework("MATHS", "x".repeat(120))).length).toBeLessThanOrEqual(90);
  });

  it("exports a homework once, in its subject's project, due at 8:00", async () => {
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).includes("/projects?")) {return json(PROJECTS);}
      if (init?.method === "PUT") {return json({ id: 42, ...JSON.parse(String(init.body)) });}
      throw new Error(`unexpected ${url}`);
    });
    const hw = homework("MATHEMATIQUES", "Exercice 1");
    expect(await exportHomeworkToVikunja(hw)).toBe(42);
    expect(await exportHomeworkToVikunja(hw)).toBe(42);
    const puts = fetchMock.mock.calls.filter(([, init]) => init?.method === "PUT");
    expect(puts).toHaveLength(1);
    expect(String(puts[0][0])).toContain("/projects/3/tasks");
    expect(new Date(JSON.parse(String(puts[0][1]?.body)).due_date).getHours()).toBe(8);
    expect(Object.values(useVikunjaStore.getState().syncedDone)).toEqual([false]);
  });

  it("auto-sync skips done, past, custom and excluded homework", async () => {
    useVikunjaStore.getState().update({ autoSync: true, subjectProjects: { eps: SUBJECT_NOT_SYNCED } });
    let created = 0;
    fetchMock.mockImplementation(async (url, init) => {
      if (String(url).includes("/projects?")) {return json(PROJECTS);}
      if (init?.method === "PUT") {return json({ id: 100 + created++ });}
      throw new Error(`unexpected ${url}`);
    });
    const list = [
      homework("MATHEMATIQUES", "A"),
      homework("MATHEMATIQUES", "B", true),
      homework("MATHEMATIQUES", "C", false, -3),
      homework("EPS", "D"),
      { ...homework("SES", "E"), custom: true } as Homework,
    ];
    expect(await syncHomeworksToVikunja(list)).toBe(1);
  });

  it("checks in Papillon what was checked in Vikunja", async () => {
    const hw = homework("MATHEMATIQUES", "Rédaction");
    const key = `${hw.subject}|${hw.content}|${hw.dueDate.toDateString()}`;
    useVikunjaStore.getState().markExported(key, 7);
    useVikunjaStore.getState().markSynced(key, false);
    fetchMock.mockResolvedValue(json({ id: 7, done: true }));
    const apply = jest.fn(async () => undefined);
    const changes = await syncCompletionWithVikunja([hw], apply);
    expect(apply).toHaveBeenCalledWith(hw, true);
    expect(changes).toEqual([{ key, homework: hw, done: true }]);
    expect(useVikunjaStore.getState().syncedDone[key]).toBe(true);
  });

  it("pushes to Vikunja what was checked in Papillon while offline", async () => {
    const hw = homework("MATHEMATIQUES", "Fiche", true);
    const key = `${hw.subject}|${hw.content}|${hw.dueDate.toDateString()}`;
    useVikunjaStore.getState().markExported(key, 8);
    useVikunjaStore.getState().markSynced(key, false);
    fetchMock.mockResolvedValue(json({ id: 8, done: false }));
    const apply = jest.fn(async () => undefined);
    expect(await syncCompletionWithVikunja([hw], apply)).toEqual([]);
    expect(apply).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
  });

  it("forgets tasks deleted in Vikunja without re-exporting them", async () => {
    const hw = homework("MATHEMATIQUES", "Supprimé");
    const key = `${hw.subject}|${hw.content}|${hw.dueDate.toDateString()}`;
    useVikunjaStore.getState().markExported(key, 9);
    fetchMock.mockResolvedValue(json({ message: "not found" }, 404));
    expect(await syncCompletionWithVikunja([hw], jest.fn(async () => undefined))).toEqual([]);
    expect(useVikunjaStore.getState().exported[key]).toBe(-1);

    useVikunjaStore.getState().update({ autoSync: true });
    fetchMock.mockReset();
    expect(await syncHomeworksToVikunja([hw])).toBe(0);
    expect(fetchMock).not.toHaveBeenCalledWith(expect.stringContaining("/tasks"), expect.objectContaining({ method: "PUT" }));
  });

  it("does nothing when completion sync is off", async () => {
    useVikunjaStore.getState().update({ syncCompletion: false });
    expect(await syncCompletionWithVikunja([homework("MATHS", "x")])).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("is a VikunjaError for HTTP failures", () => {
    expect(new VikunjaError("x", 500)).toBeInstanceOf(Error);
  });
});
