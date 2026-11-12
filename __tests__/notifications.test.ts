import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const mockScheduled: Array<{ title: string; body: string; data?: Record<string, unknown> }> = [];

jest.mock("expo-notifications", () => ({
  scheduleNotificationAsync: jest.fn(async ({ content }: { content: { title: string; body: string; data?: Record<string, unknown> } }) => {
    mockScheduled.push(content);
    return "id";
  }),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  SchedulableTriggerInputTypes: { DATE: "date" },
}));
jest.mock("@getpapillon/papillonkit", () => ({ features: { liveActivities: false }, liveActivities: { sync: jest.fn() } }));
jest.mock("@/database/useHomework", () => ({
  getHomeworkRouteId: (homework: { subject: string; content: string }) => `${homework.subject}|${homework.content}`,
  getWeekNumberFromDate: () => 1,
}));
jest.mock("@/services/calendarSync", () => ({ syncTimetableToCalendar: jest.fn(async () => 0) }));
jest.mock("@/services/vikunja", () => ({
  syncCompletionWithVikunja: jest.fn(async () => []),
  syncHomeworksToVikunja: jest.fn(async () => 0),
}));
const mockManager = {
  getGradesPeriods: jest.fn(),
  getGradesForPeriod: jest.fn(),
  getHomeworks: jest.fn(async () => []),
  getChats: jest.fn(async () => []),
  getCanteenBalances: jest.fn(async () => []),
  getAvailableClients: jest.fn(() => [{}]),
  getFailures: jest.fn(() => []),
};
jest.mock("@/services/shared", () => ({
  getManager: () => mockManager,
  initializeAccountManager: async () => mockManager,
}));
jest.mock("@/stores/account", () => ({ useAccountStore: { getState: () => ({ lastUsedAccount: "acc", accounts: [] }) } }));
jest.mock("@/utils/subjects/name", () => ({ getSubjectName: (subject: string) => subject }));
jest.mock("@/utils/logger/logger", () => ({ warn: jest.fn(), log: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }));

import { runNotificationCheck } from "@/services/notifications/check";
import { Chat } from "@/services/shared/chat";
import { Grade } from "@/services/shared/grade";
import { useNotificationsStore } from "@/stores/notifications";
import { gradeKey } from "@/utils/notifications/grades";
import { chatNotificationKey, freshUnreadChats, messageNotification } from "@/utils/notifications/messages";

const period = { id: "t1", name: "Trimestre 1", start: new Date(Date.now() - 864e5 * 30), end: new Date(Date.now() + 864e5 * 30), createdByAccount: "pronote" };

let sessionCounter = 0;
/** Pronote hands out new ids at each login: the same grade comes back with another id. */
const grade = (subject: string, description: string, value: number): Grade => ({
  id: `session${sessionCounter}-${subject}-${description}`,
  subjectId: subject,
  subjectName: subject,
  description,
  givenAt: new Date("2026-11-03T00:00:00"),
  coefficient: 1,
  outOf: { value: 20 },
  studentScore: { value },
  createdByAccount: "pronote",
});

const serveGrades = (grades: Grade[]) => {
  mockManager.getGradesPeriods.mockImplementation(async () => [period]);
  mockManager.getGradesForPeriod.mockImplementation(async () => ({
    subjects: [{ id: "s", name: "", grades }],
  }));
};

const chat = (subject: string, creator: string, unread: number, messageCount: number): Chat => ({
  id: `random-${Math.random()}`,
  subject,
  creator,
  date: new Date("2026-11-10T10:00:00"),
  unread,
  messageCount,
  createdByAccount: "pronote",
});

beforeEach(() => {
  mockScheduled.length = 0;
  sessionCounter++;
  useNotificationsStore.setState({ seenGradeKeys: {}, seenHomework: {}, seenChats: {}, balanceAlerts: {} });
  mockManager.getChats.mockImplementation(async () => []);
});

describe("notifications: grade identity", () => {
  it("ignores the per-session id", () => {
    const a = grade("MATHS", "DS 1", 15);
    sessionCounter++;
    const b = grade("MATHS", "DS 1", 15);
    expect(a.id).not.toBe(b.id);
    expect(gradeKey(a)).toBe(gradeKey(b));
  });

  it("tells apart grades that differ", () => {
    expect(gradeKey(grade("MATHS", "DS 1", 15))).not.toBe(gradeKey(grade("MATHS", "DS 1", 16)));
    expect(gradeKey(grade("MATHS", "DS 1", 15))).not.toBe(gradeKey(grade("SVT", "DS 1", 15)));
  });
});

describe("notifications: background check", () => {
  it("learns silently on the first run, then notifies only new grades", async () => {
    const existing = Array.from({ length: 16 }, (_, i) => grade("MATHS", `Note ${i}`, 10 + (i % 10)));
    serveGrades(existing);
    await runNotificationCheck();
    expect(mockScheduled).toHaveLength(0);

    // Next login: same grades with new ids → nothing new (the "16 nouvelles notes" bug).
    sessionCounter++;
    serveGrades(existing.map(item => ({ ...item, id: `again-${item.id}` })));
    await runNotificationCheck();
    expect(mockScheduled).toHaveLength(0);

    serveGrades([...existing, grade("SVT", "TP", 18)]);
    await runNotificationCheck();
    expect(mockScheduled).toHaveLength(1);
    expect(mockScheduled[0].title).toBe("Nouvelle note en SVT");
    expect(mockScheduled[0].body).toContain("18/20");
  });

  it("groups more than three new grades", async () => {
    serveGrades([grade("MATHS", "A", 10)]);
    await runNotificationCheck();
    serveGrades([grade("MATHS", "A", 10), ...["B", "C", "D", "E"].map(d => grade("SVT", d, 12))]);
    await runNotificationCheck();
    expect(mockScheduled).toHaveLength(1);
    expect(mockScheduled[0].title).toBe("4 nouvelles notes");
  });

  it("stays quiet when silent (app in the foreground) but remembers", async () => {
    serveGrades([grade("MATHS", "A", 10)]);
    await runNotificationCheck();
    serveGrades([grade("MATHS", "A", 10), grade("MATHS", "B", 11)]);
    await runNotificationCheck({ silent: true });
    await runNotificationCheck();
    expect(mockScheduled).toHaveLength(0);
  });

  it("respects the grades preference", async () => {
    useNotificationsStore.getState().setPreferences({ newGrades: false });
    serveGrades([grade("MATHS", "A", 10)]);
    await runNotificationCheck();
    serveGrades([grade("MATHS", "A", 10), grade("MATHS", "B", 11)]);
    await runNotificationCheck();
    expect(mockScheduled).toHaveLength(0);
    useNotificationsStore.getState().setPreferences({ newGrades: true });
  });

  it("notifies a new message once", async () => {
    serveGrades([]);
    mockManager.getChats.mockImplementation(async () => [chat("Sortie", "M. Dupont", 0, 2)]);
    await runNotificationCheck();
    mockManager.getChats.mockImplementation(async () => [chat("Sortie", "M. Dupont", 1, 3)]);
    await runNotificationCheck();
    await runNotificationCheck();
    expect(mockScheduled).toHaveLength(1);
    expect(mockScheduled[0]).toMatchObject({ title: "Nouveau message de M. Dupont", body: "Sortie", data: { url: "/(features)/(chats)/chats" } });
  });

  it("does not notify messages from the cache after a failure", async () => {
    serveGrades([]);
    await runNotificationCheck();
    mockManager.getChats.mockImplementation(async () => [chat("Sortie", "M. Dupont", 1, 3)]);
    mockManager.getFailures.mockImplementation(() => [{ reason: "offline" }] as never);
    await runNotificationCheck();
    mockManager.getFailures.mockImplementation(() => []);
    expect(mockScheduled).toHaveLength(0);
  });
});

describe("notifications: message helpers", () => {
  it("keys a discussion by its stable fields", () => {
    expect(chatNotificationKey(chat("A", "B", 1, 3))).toBe(chatNotificationKey(chat("A", "B", 0, 3)));
    expect(chatNotificationKey(chat("A", "B", 1, 3))).not.toBe(chatNotificationKey(chat("A", "B", 1, 4)));
  });

  it("keeps only unread discussions not notified yet", () => {
    const seen = chat("Old", "X", 1, 2);
    const fresh = freshUnreadChats([seen, chat("New", "Y", 2, 5), chat("Read", "Z", 0, 1)], [chatNotificationKey(seen)]);
    expect(fresh.map(item => item.subject)).toEqual(["New"]);
  });

  it("words the notification", () => {
    expect(messageNotification([])).toBeNull();
    expect(messageNotification([chat("Conseil", "Mme Martin", 2, 4)])).toEqual({ title: "2 nouveaux messages de Mme Martin", body: "Conseil" });
    expect(messageNotification([chat("A", "P1", 1, 1), chat("B", "P2", 2, 2)])).toEqual({ title: "3 nouveaux messages", body: "P1, P2" });
  });
});
