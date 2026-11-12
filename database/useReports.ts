import { createMMKV } from "react-native-mmkv";

import { Period } from "@/services/shared/grade";

// Evaluations and bulletins as JSON in MMKV, like period grades: shown
// offline, replaced on each successful fetch.
let storage: ReturnType<typeof createMMKV> | null = null;
const cache = () => (storage ??= createMMKV({ id: "reports-cache" }));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export function reviveDates<T>(json: string): T {
  return JSON.parse(json, (_key, value) =>
    typeof value === "string" && ISO_DATE.test(value) ? new Date(value) : value
  ) as T;
}

export const reportCacheKey = (kind: string, clientId: string, period?: Period) =>
  `${kind}:${clientId}:${period?.id ?? period?.name ?? ""}`;

export function cacheReport<T>(key: string, value: T): void {
  cache().set(key, JSON.stringify(value));
}

export function getCachedReport<T>(key: string): T | undefined {
  const raw = cache().getString(key);
  if (!raw) {return undefined;}
  try {
    return reviveDates<T>(raw);
  } catch {
    return undefined;
  }
}
