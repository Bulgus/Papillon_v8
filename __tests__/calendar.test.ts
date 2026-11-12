import { beforeEach, describe, expect, it, jest } from "@jest/globals";

type Event = { id: string; notes?: string; title?: string };
const mockEvents: Event[] = [];
let mockCounter = 0;

jest.mock("expo-calendar/legacy", () => ({
  getCalendarPermissionsAsync: async () => ({ granted: true }),
  getCalendarsAsync: async () => [{ id: "cal", title: "Papillon – Cours", allowsModifications: true }],
  getEventsAsync: async () => [...mockEvents],
  deleteEventAsync: async (id: string) => {
    mockEvents.splice(mockEvents.findIndex(event => event.id === id), 1);
  },
  createEventAsync: async (_calendar: string, event: Omit<Event, "id">) => {
    mockEvents.push({ id: `e${++mockCounter}`, ...event });
    return `e${mockCounter}`;
  },
  EntityTypes: { EVENT: "event" },
  Availability: { FREE: "free", BUSY: "busy" },
}));
jest.mock("@/database/useHomework", () => ({ getWeekNumberFromDate: (date: Date) => Math.floor(date.getTime() / 6048e5) }));
jest.mock("@/services/shared", () => ({ getManager: () => null }));
jest.mock("@/utils/subjects/name", () => ({ getSubjectName: (subject: string) => subject }));
jest.mock("@/utils/logger/logger", () => ({ warn: jest.fn() }));

import { syncTimetableToCalendar } from "@/services/calendarSync";
import { CourseStatus } from "@/services/shared/timetable";
import { useNotificationsStore } from "@/stores/notifications";

const at = (days: number, hour: number) => {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
};
const course = (id: string, days: number, hour: number, extra: Record<string, unknown> = {}) => ({
  id, subject: "MATHS", from: at(days, hour), to: at(days, hour + 1), room: "B12", teacher: "M. X", ...extra,
});

let courses: ReturnType<typeof course>[] = [];
const manager = { getWeeklyTimetable: jest.fn(async () => [{ date: new Date(), courses }]) };

beforeEach(() => {
  mockEvents.length = 0;
  useNotificationsStore.getState().setPreferences({ calendarSync: true });
});

describe("timetable → calendar", () => {
  it("creates events, then leaves them alone when nothing changed", async () => {
    courses = [course("a", 0, 8), course("b", 1, 10)];
    expect(await syncTimetableToCalendar(manager as never)).toBe(2);
    expect(mockEvents.map(event => event.title)).toEqual(["MATHS", "MATHS"]);
    expect(await syncTimetableToCalendar(manager as never)).toBe(0);
  });

  it("replaces a course that changed and marks cancellations", async () => {
    courses = [course("a", 0, 8)];
    await syncTimetableToCalendar(manager as never);
    courses = [course("a", 0, 8, { status: CourseStatus.CANCELED })];
    expect(await syncTimetableToCalendar(manager as never)).toBe(2);
    expect(mockEvents).toHaveLength(1);
    expect(mockEvents[0].title).toBe("❌ MATHS (annulé)");
  });

  it("keeps the calendar when the timetable could not be loaded", async () => {
    courses = [course("a", 0, 8)];
    await syncTimetableToCalendar(manager as never);
    courses = [];
    expect(await syncTimetableToCalendar(manager as never)).toBe(0);
    expect(mockEvents).toHaveLength(1);
  });

  it("does nothing when the option is off", async () => {
    useNotificationsStore.getState().setPreferences({ calendarSync: false });
    courses = [course("a", 0, 8)];
    expect(await syncTimetableToCalendar(manager as never)).toBe(0);
  });
});
