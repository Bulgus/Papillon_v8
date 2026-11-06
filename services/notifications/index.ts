import * as BackgroundTask from "expo-background-task";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import * as TaskManager from "expo-task-manager";
import { Platform } from "react-native";

import { log, warn } from "@/utils/logger/logger";

import type { runNotificationCheck as RunNotificationCheck } from "./check";

export const BACKGROUND_TASK = "papillon-background-refresh";

// The check pulls in the account manager, the database and every service:
// load it on first use, never while the app is starting up.
export const runNotificationCheck: typeof RunNotificationCheck = options =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  (require("./check") as typeof import("./check")).runNotificationCheck(options);

// Must run at module load (before React mounts) so iOS can wake the app
// straight into the task. Guarded: a failure here must never stop the app.
try {
  TaskManager.defineTask(BACKGROUND_TASK, async () => {
    try {
      const result = await runNotificationCheck({ refresh: true });
      log(`Background refresh done: ${result}`);
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch (error) {
      warn(`Background refresh failed: ${String(error)}`);
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
} catch (error) {
  warn(`Notifications setup at launch failed: ${String(error)}`);
}

export async function getNotificationPermission(): Promise<Notifications.PermissionStatus> {
  const { status } = await Notifications.getPermissionsAsync();
  return status;
}

export async function requestNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) {return true;}
  if (!current.canAskAgain) {return false;}
  const { granted } = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowSound: true, allowBadge: false },
  });
  return granted;
}

export async function registerBackgroundRefresh(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) {
      warn("Background tasks are restricted on this device (Low Power Mode or Background App Refresh off).");
      return;
    }
    const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK);
    if (!registered) {
      // iOS decides when to actually run it; 30 min is the floor we ask for.
      await BackgroundTask.registerTaskAsync(BACKGROUND_TASK, { minimumInterval: 30 });
    }
  } catch (error) {
    warn(`Unable to register background refresh: ${String(error)}`);
  }
}

let listenersReady = false;

/** Called once the app is ready: permissions, background task, tap routing, first check. */
export async function setupNotifications(): Promise<void> {
  if (Platform.OS === "web") {return;}

  if (!listenersReady) {
    listenersReady = true;
    Notifications.addNotificationResponseReceivedListener(response => {
      const url = response.notification.request.content.data?.url;
      if (typeof url === "string") {
        try {
          router.navigate(url as never);
        } catch (error) {
          warn(`Notification routing failed: ${String(error)}`);
        }
      }
    });
  }

  const granted = await requestNotificationPermission().catch(() => false);
  await registerBackgroundRefresh();
  if (granted) {
    // The foreground run also catches grades that arrived while the
    // background task did not get a chance to run.
    runNotificationCheck().catch(error => warn(`Notification check failed: ${String(error)}`));
  }
}

/** Dev helper: lets the user check that notifications reach the phone. */
export async function sendTestNotification(): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title: "Papillon", body: "Les notifications fonctionnent 🦋" },
    trigger: null,
  });
}
