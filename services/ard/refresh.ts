import { runAuthRefresh } from "@/services/auth/coordinator";
import { Auth } from "@/stores/account/types";

import { ArdAuthenticationError, ArdClient } from "./client";

const MAX_RETRIES = 2;

export function refreshArdAccount(
  accountId: string,
  credentials: Auth
): Promise<{ auth: Auth; session: ArdClient }> {
  // The retries stay inside one tracked login: calling refreshArdAccount
  // again from here would join its own pending promise.
  return runAuthRefresh(
    accountId,
    credentials,
    {
      rotatesCredential: false,
      classifyError: e => (e instanceof ArdAuthenticationError ? "credential_rejected" : undefined),
    },
    async tracker => {
      for (let retryCount = 0; ; retryCount++) {
        const stored = tracker.readCredentials();
        const username = String(stored.additionals?.["username"] ?? "");
        const password = String(stored.additionals?.["password"] ?? "");
        const schoolId = String(stored.additionals?.["schoolId"] ?? "");

        try {
          tracker.credentialSent(stored);
          const client = await ArdClient.login(schoolId, username, password);
          return { auth: stored, session: client };
        } catch (error) {
          // Wrong credentials won't get better by retrying.
          if (error instanceof ArdAuthenticationError || retryCount >= MAX_RETRIES) {
            throw error;
          }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
  );
}
