import { describe, expect, it, jest } from "@jest/globals";

jest.mock("@/database/useHomework", () => ({ getHomeworkRouteId: () => "key" }));
jest.mock("@/utils/subjects/name", () => ({ getSubjectName: (s: string) => s, cleanSubjectName: (s: string) => s.toLowerCase() }));
jest.mock("@/stores/account", () => ({
  useAccountStore: {
    getState: () => ({
      lastUsedAccount: "acc",
      accounts: [{ id: "acc", customisation: { subjects: { mathematiques: { name: "Maths" } } } }],
    }),
  },
}));
jest.mock("@/utils/logger/logger", () => ({ warn: jest.fn(), log: jest.fn(), error: jest.fn() }));

import { fetchArdBalance } from "@/services/ard/balance";
import { ArdClient } from "@/services/ard/client";
import { fetchARDHistory } from "@/services/ard/history";
import { VikunjaTask } from "@/services/vikunja/api";
import { useVikunjaStore } from "@/stores/vikunja";
import { vikunjaTasksAsHomework } from "@/stores/vikunja/tasks";

const fakeArd = {
  getAccount: async () => ({
    user: { uid: 1 },
    walletData: [
      { walletOrid: 2, walletName: "W2", walletAmount: 1000 },
      { walletOrid: 3, walletName: "W3", walletAmount: 250 },
      { walletOrid: 9, walletName: "Autre", walletAmount: 0 },
    ],
  }),
  getOperations: async () => [{ operationDate: 1_762_000_000, operationName: "Rechargement", credit: 2000, debit: null }],
  getConsumptions: async () => [{ consumptionDate: 1_762_100_000, consumptionDescription: "Repas", amount: 330 }],
} as unknown as ArdClient;

describe("ARD: balance and history", () => {
  it("labels wallets and counts meals left (amounts in cents)", async () => {
    const balances = await fetchArdBalance(fakeArd, "acc", { additionals: { mealPrice: "330" } });
    expect(balances.map(balance => [balance.label, balance.amount, balance.lunchRemaining])).toEqual([
      ["Restauration", 1000, 3],
      ["Cafétéria", 250, 0],
      ["Autre", 0, 0],
    ]);
  });

  it("does not guess meals without a meal price", async () => {
    const balances = await fetchArdBalance(fakeArd, "acc", {});
    expect(balances[0]).toMatchObject({ lunchPrice: 0, lunchRemaining: 0 });
  });

  it("merges top-ups and meals, newest first", async () => {
    const history = await fetchARDHistory(fakeArd, "acc");
    expect(history.map(item => [item.label, item.amount])).toEqual([
      ["Repas", -330],
      ["Rechargement", 2000],
    ]);
  });
});

describe("Vikunja tasks in the Tasks tab", () => {
  const task = (id: number, extra: Partial<VikunjaTask> = {}): VikunjaTask => ({
    id,
    title: `Tâche ${id}`,
    description: "",
    done: false,
    due_date: "0001-01-01T00:00:00Z",
    priority: 0,
    project_id: 3,
    ...extra,
  });
  const projects = [
    { id: 2, title: "Scolaire", parent_project_id: 0, is_archived: false },
    { id: 3, title: "Mathématiques", parent_project_id: 2, is_archived: false, hex_color: "1973ff" },
  ];
  const weekStart = new Date("2026-11-09T00:00:00");

  it("wears the subject of its project and shows the project path", () => {
    const [item] = vikunjaTasksAsHomework([task(1, { description: "<p>Lire le chapitre</p><p>2</p>" })], projects, {}, weekStart);
    expect(item).toMatchObject({
      id: "vikunja:1",
      subject: "mathematiques",
      content: "Tâche 1\nLire le chapitre",
      createdByAccount: "vikunja",
      vikunja: { taskId: 1, projectPath: "Scolaire › Mathématiques", color: "#1973ff", undated: true },
    });
  });

  it("flags overdue tasks and important ones", () => {
    const [item] = vikunjaTasksAsHomework([task(2, { due_date: "2026-11-01T08:00:00Z", priority: 3 })], projects, {}, weekStart);
    expect(item.vikunja).toMatchObject({ overdue: true, undated: false });
    expect(item.evaluation).toBe(true);
  });

  it("hides tasks created from a homework (shown as the homework) and keeps local ticks", () => {
    useVikunjaStore.getState().markExported("hw", 5);
    const items = vikunjaTasksAsHomework([task(5), task(6)], projects, { 6: true }, weekStart);
    expect(items.map(item => [item.id, item.isDone])).toEqual([["vikunja:6", true]]);
  });
});
