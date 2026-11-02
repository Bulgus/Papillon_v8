import { Auth } from "@/stores/account/types";

import { ArdAuthenticationError, ArdClient } from "./client";

export async function refreshArdAccount(
  accountId: string,
  credentials: Auth,
  retryCount: number = 0
): Promise<{ auth: Auth; session: ArdClient }> {
  const username = String(credentials.additionals?.["username"] ?? "");
  const password = String(credentials.additionals?.["password"] ?? "");
  const schoolId = String(credentials.additionals?.["schoolId"] ?? "");

  try {
    const client = await ArdClient.login(schoolId, username, password);
    return { auth: credentials, session: client };
  } catch (error) {
    // Wrong credentials won't get better by retrying.
    if (!(error instanceof ArdAuthenticationError) && retryCount < 2) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return refreshArdAccount(accountId, credentials, retryCount + 1);
    }
    throw error;
  }
}
