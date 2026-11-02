import { Auth, Services } from "@/stores/account/types";
import { error } from "@/utils/logger/logger";

import { Balance } from "../shared/balance";
import { CanteenHistoryItem, QRCode } from "../shared/canteen";
import { Capabilities, SchoolServicePlugin } from "../shared/types";
import { fetchArdBalance } from "./balance";
import { ArdClient } from "./client";
import { fetchARDHistory } from "./history";
import { fetchArdQRCode } from "./qrcode";
import { refreshArdAccount } from "./refresh";

export class ARD implements SchoolServicePlugin {
  displayName = "ARD";
  service = Services.ARD;
  capabilities: Capabilities[] = [Capabilities.REFRESH];
  session: ArdClient | undefined = undefined;
  authData: Auth = {};

  constructor(public accountId: string) {}

  async refreshAccount(credentials: Auth): Promise<ARD> {
    const refresh = await refreshArdAccount(this.accountId, credentials);
    this.authData = refresh.auth;
    this.session = refresh.session;
    this.capabilities = [
      Capabilities.REFRESH,
      Capabilities.CANTEEN_BALANCE,
      Capabilities.CANTEEN_HISTORY,
      Capabilities.CANTEEN_QRCODE,
    ];
    return this;
  }

  async getCanteenBalances(): Promise<Balance[]> {
    if (this.session) {
      return fetchArdBalance(this.session, this.accountId, this.authData);
    }
    throw error("Session is not valid", "ARD.getCanteenBalances");
    return [];
  }

  async getCanteenTransactionsHistory(): Promise<CanteenHistoryItem[]> {
    if (this.session) {
      return fetchARDHistory(this.session, this.accountId);
    }
    throw error("Session is not valid", "ARD.getCanteenTransactionsHistory");
    return [];
  }

  async getCanteenQRCodes(): Promise<QRCode> {
    if (!this.session) {
      throw new Error("Session ARD invalide");
    }
    return fetchArdQRCode(this.session, this.accountId);
  }
}
