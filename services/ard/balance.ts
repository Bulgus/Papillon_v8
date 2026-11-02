import { Auth } from "@/stores/account/types";

import { Balance } from "../shared/balance";
import { ArdClient } from "./client";

const WALLET_LABELS: Record<number, string> = {
  2: "Restauration",
  3: "Cafétéria",
};

export async function fetchArdBalance(
  session: ArdClient,
  accountId: string,
  auth: Auth
): Promise<Balance[]> {
  const lunchPrice = Number(auth.additionals?.["mealPrice"] ?? 0) || 0;
  const account = await session.getAccount();

  return (account.walletData ?? []).map(wallet => {
    const amount = wallet.walletAmount ?? 0;
    return {
      amount,
      currency: "€",
      lunchRemaining: lunchPrice > 0 ? Math.max(0, Math.floor(amount / lunchPrice)) : 0,
      lunchPrice,
      label: WALLET_LABELS[wallet.walletOrid] ?? wallet.walletName ?? "Solde",
      createdByAccount: accountId,
    };
  });
}
