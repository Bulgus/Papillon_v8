import * as PapillonKit from "@getpapillon/papillonkit";
import * as Notifications from "expo-notifications";

import { getHomeworkRouteId, getWeekNumberFromDate } from "@/database/useHomework";
import { getManager, initializeAccountManager } from "@/services/shared";
import type { AccountManager } from "@/services/shared";
import { Balance } from "@/services/shared/balance";
import { Grade } from "@/services/shared/grade";
import { Homework } from "@/services/shared/homework";
import { CourseStatus } from "@/services/shared/timetable";
import { Capabilities } from "@/services/shared/types";
import { syncTimetableToCalendar } from "@/services/calendarSync";
import { syncCompletionWithVikunja, syncHomeworksToVikunja } from "@/services/vikunja";
import { useAccountStore } from "@/stores/account";
import { useNotificationsStore } from "@/stores/notifications";
import { getCurrentPeriod } from "@/utils/grades/helper/period";
import { log, warn } from "@/utils/logger/logger";
import { gradeKey } from "@/utils/notifications/grades";
import { chatNotificationKey, freshUnreadChats, messageNotification } from "@/utils/notifications/messages";
import { getSubjectName } from "@/utils/subjects/name";

export const DIGEST_NOTIFICATION_ID = "papillon-daily-digest";

const euros = (cents: number) => (cents / 100).toFixed(2).replace(".", ",") + " €";

const formatScore = (grade: Grade): string => {
  const score = grade.studentScore;
  if (!score) {return "";}
  if (score.disabled || Number.isNaN(score.value)) {return score.status ?? "";}
  const outOf = grade.outOf?.value ?? 20;
  const value = Number.isInteger(score.value) ? String(score.value) : score.value.toFixed(2).replace(/\.?0+$/, "").replace(".", ",");
  return `${value}/${outOf}`;
};

export { gradeKey };

async function notify(title: string, body: string, data: Record<string, unknown> = {}) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data, sound: "default" },
    trigger: null,
  });
}

function relativeDay(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);
  const diff = Math.round((target.getTime() - today.getTime()) / 86400000);
  if (diff === 0) {return "aujourd'hui";}
  if (diff === 1) {return "demain";}
  return "pour " + target.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
}

async function checkGrades(manager: AccountManager, accountId: string, silent: boolean): Promise<number> {
  const periods = await manager.getGradesPeriods();
  // One current period per service (e.g. two Pronote accounts).
  const byService = new Map<string, typeof periods>();
  for (const period of periods) {
    const list = byService.get(period.createdByAccount) ?? [];
    list.push(period);
    byService.set(period.createdByAccount, list);
  }
  const grades: Grade[] = [];
  for (const [serviceId, list] of byService) {
    const period = getCurrentPeriod(list);
    if (!period) {continue;}
    const periodGrades = await manager.getGradesForPeriod(period, serviceId);
    grades.push(
      ...(periodGrades?.subjects ?? []).flatMap(subject =>
        (subject.grades ?? []).map(grade => ({ ...grade, subjectName: grade.subjectName || subject.name }))
      )
    );
  }
  if (grades.length === 0) {return 0;}

  const store = useNotificationsStore.getState();
  const previous = store.seenGradeKeys[accountId];
  const seen = new Set(previous ?? []);
  const fresh = grades.filter(grade => !seen.has(gradeKey(grade)));

  // The first run only learns what already exists.
  const firstRun = previous === undefined;
  if (!silent && !firstRun && store.preferences.newGrades && fresh.length > 0) {
    if (fresh.length <= 3) {
      for (const grade of fresh) {
        const average = grade.averageScore && !grade.averageScore.disabled ? ` · moy. classe ${grade.averageScore.value.toFixed(2).replace(".", ",")}` : "";
        await notify(
          `Nouvelle note en ${getSubjectName(grade.subjectName)}`,
          `${formatScore(grade)}${grade.description ? " · " + grade.description : ""}${average}`,
          { url: "/(tabs)/grades" }
        );
      }
    } else {
      const subjects = [...new Set(fresh.map(grade => getSubjectName(grade.subjectName)))];
      await notify(
        `${fresh.length} nouvelles notes`,
        subjects.slice(0, 4).join(", ") + (subjects.length > 4 ? "…" : ""),
        { url: "/(tabs)/grades" }
      );
    }
  }

  store.setSeen("seenGradeKeys", accountId, [...seen, ...fresh.map(gradeKey)]);
  return firstRun ? 0 : fresh.length;
}

async function checkHomework(manager: AccountManager, accountId: string, silent: boolean): Promise<{ count: number; homeworks: Homework[] }> {
  const now = new Date();
  const nextWeek = new Date(now.getTime() + 7 * 86400000);
  const lists = await Promise.all([
    manager.getHomeworks(getWeekNumberFromDate(now)),
    manager.getHomeworks(getWeekNumberFromDate(nextWeek)),
  ]);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const homeworks = lists.flat().filter(hw => !hw.custom && new Date(hw.dueDate).getTime() >= today.getTime());

  const store = useNotificationsStore.getState();
  const previous = store.seenHomework[accountId];
  const seen = new Set(previous ?? []);
  const fresh = homeworks.filter(hw => !hw.isDone && !seen.has(getHomeworkRouteId(hw)));
  const firstRun = previous === undefined;

  if (!silent && !firstRun && store.preferences.newHomework && fresh.length > 0) {
    if (fresh.length <= 3) {
      for (const hw of fresh) {
        const text = hw.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
        await notify(
          `${hw.evaluation ? "Nouvelle évaluation" : "Nouveau devoir"} en ${getSubjectName(hw.subject)} ${relativeDay(new Date(hw.dueDate))}`,
          text.length > 160 ? text.slice(0, 157) + "…" : text,
          { url: "/(tabs)/tasks" }
        );
      }
    } else {
      await notify(`${fresh.length} nouveaux devoirs`, "Ouvre Papillon pour les voir.", { url: "/(tabs)/tasks" });
    }
  }

  store.setSeen("seenHomework", accountId, [...seen, ...homeworks.map(getHomeworkRouteId)]);
  return { count: firstRun ? 0 : fresh.length, homeworks };
}

async function checkMessages(manager: AccountManager, accountId: string, silent: boolean): Promise<number> {
  if (manager.getAvailableClients(Capabilities.CHAT_READ).length === 0) {return 0;}
  const chats = await manager.getChats();
  // The manager falls back to the cache on failure: old states, nothing new.
  if (manager.getFailures(Capabilities.CHAT_READ).length > 0) {return 0;}

  const store = useNotificationsStore.getState();
  const previous = store.seenChats[accountId];
  const fresh = freshUnreadChats(chats, previous ?? []);
  const firstRun = previous === undefined;

  const notification = messageNotification(fresh);
  if (!silent && !firstRun && store.preferences.newMessages && notification) {
    await notify(notification.title, notification.body, { url: "/(features)/(chats)/chats" });
  }

  store.setSeen("seenChats", accountId, [...(previous ?? []), ...chats.map(chatNotificationKey)]);
  return firstRun ? 0 : fresh.length;
}

async function checkBalances(manager: AccountManager): Promise<number> {
  const store = useNotificationsStore.getState();
  if (!store.preferences.lowBalance) {return 0;}
  let balances: Balance[] = [];
  try {
    balances = await manager.getCanteenBalances();
  } catch {
    return 0;
  }
  let sent = 0;
  for (const balance of balances) {
    const key = `${balance.createdByAccount}:${balance.label}`;
    const meals = balance.lunchPrice > 0 ? Math.floor(balance.amount / balance.lunchPrice) : null;
    const low = meals !== null
      ? meals <= store.preferences.lowBalanceMeals
      : balance.amount <= store.preferences.lowBalanceAmount * 100;

    const previous = store.balanceAlerts[key];
    if (!low) {
      if (previous) {store.setBalanceAlert(key, null);}
      continue;
    }
    // Warn once per drop: again only if the balance went down since.
    if (previous && balance.amount >= previous.amount) {continue;}
    {
      await notify(
        meals !== null
          ? meals <= 0 ? "Plus aucun repas sur ta carte self" : `Plus que ${meals} repas sur ta carte self`
          : "Solde de cantine bas",
        `Il reste ${euros(balance.amount)} (${balance.label}). Pense à recharger !`,
        { url: "/(features)/(cards)/cards" }
      );
      sent++;
    }
    store.setBalanceAlert(key, balance.amount);
  }
  return sent;
}

/**
 * Schedules tomorrow's (or today's, if still ahead) morning digest from the
 * timetable and homework already known. Replaces the previous one.
 */
export async function scheduleDailyDigest(manager?: AccountManager | null): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(DIGEST_NOTIFICATION_ID).catch(() => undefined);
  const { preferences } = useNotificationsStore.getState();
  if (!preferences.dailyDigest) {return;}
  const currentManager = manager ?? getManager(true);
  if (!currentManager) {return;}

  const now = new Date();
  const at = new Date();
  at.setHours(preferences.dailyDigestHour, 0, 0, 0);
  if (at.getTime() <= now.getTime()) {at.setDate(at.getDate() + 1);}

  const dayStart = new Date(at);
  dayStart.setHours(0, 0, 0, 0);
  const sameDay = (date: Date) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d.getTime() === dayStart.getTime();
  };

  try {
    const [days, homeworks] = await Promise.all([
      currentManager.getWeeklyTimetable(getWeekNumberFromDate(at), at),
      currentManager.getHomeworks(getWeekNumberFromDate(at)),
    ]);
    const courses = days
      .flatMap(day => day.courses)
      .filter(course => sameDay(course.from))
      .sort((a, b) => new Date(a.from).getTime() - new Date(b.from).getTime());
    const dueHomework = homeworks.filter(hw => sameDay(hw.dueDate) && !hw.isDone);

    if (courses.length === 0 && dueHomework.length === 0) {return;}

    const active = courses.filter(course => course.status !== CourseStatus.CANCELED);
    const canceled = courses.filter(course => course.status === CourseStatus.CANCELED);
    const time = (date: Date) => new Date(date).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });

    const lines: string[] = [];
    if (active.length > 0) {
      lines.push(`${active.length} cours de ${time(active[0].from)} à ${time(active[active.length - 1].to)} · 1er : ${getSubjectName(active[0].subject)}${active[0].room ? ` (${active[0].room})` : ""}`);
    }
    if (canceled.length > 0) {
      lines.push(`Annulé : ${canceled.map(course => getSubjectName(course.subject)).join(", ")}`);
    }
    if (dueHomework.length > 0) {
      lines.push(`${dueHomework.length} devoir${dueHomework.length > 1 ? "s" : ""} à rendre : ${[...new Set(dueHomework.map(hw => getSubjectName(hw.subject)))].join(", ")}`);
    }

    await Notifications.scheduleNotificationAsync({
      identifier: DIGEST_NOTIFICATION_ID,
      content: {
        title: `Ta journée — ${at.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}`,
        body: lines.join("\n"),
        data: { url: "/(tabs)/calendar" },
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
  } catch (error) {
    warn(`Daily digest scheduling failed: ${String(error)}`);
  }
}

let running: Promise<string> | null = null;

/**
 * Fetches grades, homework and balances, notifies about what is new and
 * remembers it. `silent` only records the current state (used when the
 * app is in the foreground: the user is already looking).
 */
export function runNotificationCheck(options: { silent?: boolean; refresh?: boolean } = {}): Promise<string> {
  if (running) {return running;}
  running = (async () => {
    const accountId = useAccountStore.getState().lastUsedAccount;
    if (!accountId) {return "no-account";}

    let manager = getManager(true);
    if (!manager || options.refresh) {
      manager = await initializeAccountManager();
    }

    const results: string[] = [];
    const silent = Boolean(options.silent);

    const step = async (name: string, fn: () => Promise<number | string>) => {
      try {
        results.push(`${name}:${await fn()}`);
      } catch (error) {
        warn(`Notification check (${name}) failed: ${String(error)}`);
        results.push(`${name}:error`);
      }
    };

    let homeworks: Homework[] = [];
    await step("grades", () => checkGrades(manager, accountId, silent));
    await step("homework", async () => {
      const result = await checkHomework(manager, accountId, silent);
      homeworks = result.homeworks;
      return result.count;
    });
    await step("messages", () => checkMessages(manager, accountId, silent));
    await step("balance", () => checkBalances(manager));
    await step("vikunja", async () => {
      const changed = await syncCompletionWithVikunja(homeworks);
      return (await syncHomeworksToVikunja(homeworks)) + changed.length;
    });
    await step("calendar", () => syncTimetableToCalendar(manager));
    await step("liveActivity", async () => {
      // Ends finished course activities and hands the current one to iOS.
      if (PapillonKit.features.liveActivities) {await PapillonKit.liveActivities.sync();}
      return "ok";
    });
    await step("digest", async () => {
      await scheduleDailyDigest(manager);
      return "ok";
    });

    const summary = results.join(" ");
    useNotificationsStore.getState().setLastCheck(summary);
    log(`Notification check: ${summary}`);
    return summary;
  })().finally(() => {
    running = null;
  });
  return running;
}
