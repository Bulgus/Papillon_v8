import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createMMKVStorage } from "../global";

const TOKEN_KEY = "vikunja-api-token";
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};
let cachedToken: string | null | undefined;

/** The API token lives in the Keychain, never in MMKV. */
export async function getVikunjaToken(): Promise<string | null> {
  if (cachedToken !== undefined) {return cachedToken;}
  try {
    cachedToken = await SecureStore.getItemAsync(TOKEN_KEY, SECURE_OPTIONS);
  } catch {
    cachedToken = null;
  }
  return cachedToken;
}

async function setVikunjaToken(token: string | null) {
  cachedToken = token;
  if (token) {
    await SecureStore.setItemAsync(TOKEN_KEY, token, SECURE_OPTIONS);
  } else {
    await SecureStore.deleteItemAsync(TOKEN_KEY, SECURE_OPTIONS).catch(() => undefined);
  }
}

export interface VikunjaState {
  /** API base URL, e.g. https://vikunja.example.com/api/v1 */
  baseURL: string | null;
  /** True once a token was saved in the Keychain. */
  connected: boolean;
  tokenId?: number;
  displayName?: string;
  /** Project used when no subject project matches. */
  defaultProjectId?: number;
  /** Manual overrides: normalized subject → project id. */
  subjectProjects: Record<string, number>;
  /** Push every new homework to Vikunja automatically. */
  autoSync: boolean;
  /** Mirror "done" between Papillon and Vikunja for exported homework. */
  syncCompletion: boolean;
  /** Show Vikunja tasks in Papillon's Tasks tab, next to the homework. */
  showInApp: boolean;
  /** New tasks from the "+" button go to Vikunja (remembered choice). */
  newTasksToVikunja: boolean;
  /** Tasks tab filter: everything, school homework only, or Vikunja only. */
  tasksSource: "all" | "school" | "vikunja";
  /** homework key → Vikunja task id (-1: task deleted in Vikunja, never re-exported). */
  exported: Record<string, number>;
  /** homework key → "done" state both sides last agreed on. */
  syncedDone: Record<string, boolean>;
  lastSyncAt?: number;

  connect: (data: { baseURL: string; token: string; tokenId?: number; displayName?: string }) => Promise<void>;
  disconnect: () => Promise<void>;
  update: (changes: Partial<Omit<VikunjaState, "connect" | "disconnect" | "update" | "markExported" | "forgetExported" | "markSynced">>) => void;
  markExported: (homeworkKey: string, taskId: number) => void;
  forgetExported: (homeworkKey: string) => void;
  markSynced: (homeworkKey: string, done: boolean) => void;
}

const initial = {
  baseURL: null,
  connected: false,
  tokenId: undefined,
  displayName: undefined,
  defaultProjectId: undefined,
  subjectProjects: {},
  autoSync: false,
  syncCompletion: true,
  showInApp: true,
  newTasksToVikunja: true,
  tasksSource: "all" as const,
  exported: {},
  syncedDone: {},
  lastSyncAt: undefined,
};

export const useVikunjaStore = create<VikunjaState>()(
  persist(
    set => ({
      ...initial,
      connect: async ({ token, ...data }) => {
        await setVikunjaToken(token);
        set({ ...data, connected: true });
      },
      disconnect: async () => {
        await setVikunjaToken(null);
        set({ ...initial });
      },
      update: changes => set(changes),
      markExported: (homeworkKey, taskId) =>
        set(state => ({ exported: { ...state.exported, [homeworkKey]: taskId } })),
      forgetExported: homeworkKey =>
        set(state => {
          const exported = { ...state.exported };
          delete exported[homeworkKey];
          return { exported };
        }),
      markSynced: (homeworkKey, done) =>
        set(state => ({ syncedDone: { ...state.syncedDone, [homeworkKey]: done } })),
    }),
    {
      name: "vikunja-storage",
      storage: createMMKVStorage<VikunjaState>("vikunja"),
      version: 2,
      migrate: persisted => ({ syncedDone: {}, ...(persisted as object) }) as VikunjaState,
    }
  )
);

export const isVikunjaConnected = () => {
  const { baseURL, connected } = useVikunjaStore.getState();
  return Boolean(baseURL && connected);
};
