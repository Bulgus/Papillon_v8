import { CanteenHistoryItem } from "../shared/canteen";
import { ArdClient } from "./client";

export async function fetchARDHistory(
  session: ArdClient,
  accountId: string
): Promise<CanteenHistoryItem[]> {
  const [operations, consumptions] = await Promise.all([
    session.getOperations(),
    session.getConsumptions(),
  ]);

  return [
    ...operations.map(item => ({
      date: new Date(item.operationDate * 1000),
      label: item.operationName,
      currency: "€",
      amount: (item.credit ?? 0) - (item.debit ?? 0),
      createdByAccount: accountId,
    })),
    ...consumptions.map(item => ({
      date: new Date(item.consumptionDate * 1000),
      label: item.consumptionDescription,
      currency: "€",
      amount: -item.amount,
      createdByAccount: accountId,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());
}
