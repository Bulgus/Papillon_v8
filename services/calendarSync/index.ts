import * as Calendar from "expo-calendar/legacy";
import { Platform } from "react-native";

import { getWeekNumberFromDate } from "@/database/useHomework";
import { getManager } from "@/services/shared";
import type { AccountManager } from "@/services/shared";
import { Course, CourseStatus, CourseType } from "@/services/shared/timetable";
import { useNotificationsStore } from "@/stores/notifications";
import { warn } from "@/utils/logger/logger";
import { getSubjectName } from "@/utils/subjects/name";

/**
 * Mirrors the timetable into a dedicated "Papillon" calendar, so the native
 * Calendar widgets (Home Screen, Lock Screen, StandBy, Watch) show today's
 * courses. Unlike PapillonKit's widget, this needs no App Group, so it keeps
 * working on re-signed (sideloaded) builds.
 */

const CALENDAR_TITLE = "Papillon – Cours";
const MARKER = "papillon-course:";
const DAYS_AHEAD = 14;

export async function requestCalendarAccess(): Promise<boolean> {
  const current = await Calendar.getCalendarPermissionsAsync();
  if (current.granted) {return true;}
  const result = await Calendar.requestCalendarPermissionsAsync();
  return result.granted;
}

async function getOrCreateCalendar(): Promise<string> {
  const stored = useNotificationsStore.getState().calendarId;
  const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
  const existing =
    calendars.find(calendar => calendar.id === stored) ??
    calendars.find(calendar => calendar.title === CALENDAR_TITLE && calendar.allowsModifications);
  if (existing) {
    if (existing.id !== stored) {useNotificationsStore.getState().setCalendarId(existing.id);}
    return existing.id;
  }

  let sourceId: string | undefined;
  let source: Calendar.Source | undefined;
  if (Platform.OS === "ios") {
    const defaultCalendar = await Calendar.getDefaultCalendarAsync().catch(() => null);
    source = defaultCalendar?.source;
    if (!source) {
      const sources = await Calendar.getSourcesAsync();
      source = sources.find(item => item.type === Calendar.SourceType.LOCAL) ?? sources[0];
    }
    sourceId = source?.id;
  } else {
    source = { isLocalAccount: true, name: "Papillon", type: Calendar.SourceType.LOCAL } as Calendar.Source;
  }

  const id = await Calendar.createCalendarAsync({
    title: CALENDAR_TITLE,
    name: "papillon",
    color: "#29947A",
    entityType: Calendar.EntityTypes.EVENT,
    sourceId,
    source,
    ownerAccount: "Papillon",
    accessLevel: Calendar.CalendarAccessLevel.OWNER,
  });
  useNotificationsStore.getState().setCalendarId(id);
  return id;
}

const courseKey = (course: Course) =>
  `${MARKER}${course.id || ""}|${new Date(course.from).getTime()}|${new Date(course.to).getTime()}|${course.subject}|${course.room ?? ""}|${course.status ?? ""}`;

function eventFor(course: Course) {
  const canceled = course.status === CourseStatus.CANCELED;
  const subject = getSubjectName(course.subject);
  const details = [
    course.teacher,
    course.group,
    course.customStatus,
    course.status === CourseStatus.EDITED ? "Cours modifié" : null,
    course.status === CourseStatus.EVALUATED ? "Évaluation" : null,
    course.additionalInfo,
  ].filter(Boolean);
  return {
    title: canceled ? `❌ ${subject} (annulé)` : course.status === CourseStatus.EVALUATED ? `📝 ${subject}` : subject,
    startDate: new Date(course.from),
    endDate: new Date(course.to),
    location: course.room || undefined,
    notes: [...details, "", courseKey(course)].join("\n"),
    url: course.url || undefined,
    alarms: [],
    availability: canceled ? Calendar.Availability.FREE : Calendar.Availability.BUSY,
  };
}

let syncing = false;

/** Returns the number of events created + removed. */
export async function syncTimetableToCalendar(manager?: AccountManager | null): Promise<number> {
  const { preferences } = useNotificationsStore.getState();
  if (!preferences.calendarSync || syncing) {return 0;}
  const currentManager = manager ?? getManager(true);
  if (!currentManager) {return 0;}

  const permission = await Calendar.getCalendarPermissionsAsync();
  if (!permission.granted) {return 0;}

  syncing = true;
  try {
    const calendarId = await getOrCreateCalendar();
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + DAYS_AHEAD * 86400000);

    const weekDates: Date[] = [];
    for (let date = new Date(start); date < end; date = new Date(date.getTime() + 7 * 86400000)) {
      weekDates.push(date);
    }
    weekDates.push(end);
    const weeks = new Map<number, Date>();
    for (const date of weekDates) {weeks.set(getWeekNumberFromDate(date), date);}

    const days = (
      await Promise.all([...weeks].map(([week, date]) => currentManager.getWeeklyTimetable(week, date).catch(() => [])))
    ).flat();

    const courses = days
      .flatMap(day => day.courses)
      .filter(course => course.type !== CourseType.VACATION)
      .filter(course => {
        const from = new Date(course.from).getTime();
        return from >= start.getTime() && from < end.getTime();
      });

    // No data at all (offline, service down): keep what is there.
    if (courses.length === 0) {return 0;}

    const wanted = new Map(courses.map(course => [courseKey(course), course]));
    const existing = await Calendar.getEventsAsync([calendarId], start, end);

    let changes = 0;
    for (const event of existing) {
      const key = event.notes?.split("\n").find(line => line.startsWith(MARKER));
      if (key && wanted.has(key)) {
        wanted.delete(key);
      } else {
        await Calendar.deleteEventAsync(event.id).catch(() => undefined);
        changes++;
      }
    }
    for (const course of wanted.values()) {
      await Calendar.createEventAsync(calendarId, eventFor(course));
      changes++;
    }
    return changes;
  } catch (error) {
    warn(`Calendar sync failed: ${String(error)}`);
    throw error;
  } finally {
    syncing = false;
  }
}

/** Removes the Papillon calendar (when the option is turned off). */
export async function removePapillonCalendar(): Promise<void> {
  const id = useNotificationsStore.getState().calendarId;
  if (!id) {return;}
  try {
    await Calendar.deleteCalendarAsync(id);
  } catch (error) {
    warn(`Unable to delete Papillon calendar: ${String(error)}`);
  }
  useNotificationsStore.getState().setCalendarId(undefined);
}

