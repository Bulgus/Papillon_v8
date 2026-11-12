import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createMMKVStorage } from "../global";

export interface NotificationPreferences {
  newGrades: boolean;
  newHomework: boolean;
  lowBalance: boolean;
  /** Alert when fewer meals than this remain (or the € amount below when the meal price is unknown). */
  lowBalanceMeals: number;
  lowBalanceAmount: number;
  /** Morning digest of the day's courses and homework. */
  dailyDigest: boolean;
  dailyDigestHour: number;
  /** Mirror the timetable into a "Papillon – Cours" calendar (for the native Calendar widgets). */
  calendarSync: boolean;
}

export interface NotificationsState {
  preferences: NotificationPreferences;
  /** Per account: keys of grades/homework already seen (bounded). */
  /** @deprecated id-based keys, unstable across Pronote sessions. */
  seenGrades: Record<string, string[]>;
  /** Grade keys built from stable fields (see gradeKey). */
  seenGradeKeys: Record<string, string[]>;
  seenHomework: Record<string, string[]>;
  /** Per wallet: amount at which we last warned. */
  balanceAlerts: Record<string, { amount: number; at: number }>;
  lastCheckAt?: number;
  lastCheckResult?: string;
  calendarId?: string;

  setPreferences: (changes: Partial<NotificationPreferences>) => void;
  setSeen: (kind: "seenGradeKeys" | "seenHomework", accountId: string, keys: string[]) => void;
  setBalanceAlert: (walletKey: string, amount: number | null) => void;
  setLastCheck: (result: string) => void;
  setCalendarId: (id: string | undefined) => void;
}

const MAX_SEEN = 1500;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  newGrades: true,
  newHomework: true,
  lowBalance: true,
  lowBalanceMeals: 3,
  lowBalanceAmount: 10,
  dailyDigest: false,
  dailyDigestHour: 7,
  calendarSync: false,
};

export const useNotificationsStore = create<NotificationsState>()(
  persist(
    set => ({
      preferences: DEFAULT_NOTIFICATION_PREFERENCES,
      seenGrades: {},
      seenGradeKeys: {},
      seenHomework: {},
      balanceAlerts: {},
      setPreferences: changes =>
        set(state => ({ preferences: { ...state.preferences, ...changes } })),
      setSeen: (kind, accountId, keys) =>
        set(state => ({ [kind]: { ...state[kind], [accountId]: keys.slice(-MAX_SEEN) } }) as Partial<NotificationsState>),
      setBalanceAlert: (walletKey, amount) =>
        set(state => {
          const balanceAlerts = { ...state.balanceAlerts };
          if (amount === null) {delete balanceAlerts[walletKey];}
          else {balanceAlerts[walletKey] = { amount, at: Date.now() };}
          return { balanceAlerts };
        }),
      setLastCheck: result => set({ lastCheckAt: Date.now(), lastCheckResult: result }),
      setCalendarId: id => set({ calendarId: id }),
    }),
    {
      name: "notifications-storage",
      storage: createMMKVStorage("notifications"),
      version: 1,
      merge: (persisted, current) => {
        const state = (persisted ?? {}) as Partial<NotificationsState>;
        return {
          ...current,
          ...state,
          preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, ...(state.preferences ?? {}) },
        };
      },
    }
  )
);
