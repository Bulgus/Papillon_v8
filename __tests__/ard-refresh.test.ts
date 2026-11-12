import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/utils/logger/logger", () => ({ warn: jest.fn(), log: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }));
jest.mock("@/stores/account", () => ({
  useAccountStore: { getState: () => ({ accounts: [], updateServiceAuthData: jest.fn() }) },
}));
jest.mock("@/services/ard/client", () => {
  class ArdAuthenticationError extends Error {}
  return { ArdAuthenticationError, ArdClient: { login: jest.fn() } };
});

import { ArdAuthenticationError, ArdClient } from "@/services/ard/client";
import { refreshArdAccount } from "@/services/ard/refresh";
import { clearAuthState, getAuthState } from "@/services/auth/coordinator";

const login = ArdClient.login as unknown as jest.Mock<(...args: unknown[]) => Promise<unknown>>;
const credentials = { additionals: { username: "E00000", password: "x", schoolId: "clisson-aime_cesaire" } };

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  login.mockReset();
  clearAuthState("ard-1");
});

const settle = async <T>(promise: Promise<T>) => {
  const result = promise.then(value => ({ value }), error => ({ error }));
  await jest.runAllTimersAsync();
  return result;
};

describe("ARD login through the auth coordinator", () => {
  it("logs in with the stored credentials", async () => {
    login.mockResolvedValue({ slug: "s" });
    const result = await settle(refreshArdAccount("ard-1", credentials));
    expect(result).toEqual({ value: { auth: credentials, session: { slug: "s" } } });
    expect(login).toHaveBeenCalledWith("clisson-aime_cesaire", "E00000", "x");
  });

  it("retries network errors, then succeeds", async () => {
    login.mockRejectedValueOnce(new Error("Network request failed")).mockResolvedValue({ slug: "s" });
    const result = await settle(refreshArdAccount("ard-1", credentials));
    expect("value" in result).toBe(true);
    expect(login).toHaveBeenCalledTimes(2);
  });

  it("never retries wrong credentials and records why", async () => {
    login.mockRejectedValue(new ArdAuthenticationError("Identifiants incorrects"));
    const result = await settle(refreshArdAccount("ard-1", credentials));
    expect("error" in result).toBe(true);
    expect(login).toHaveBeenCalledTimes(1);
    expect(getAuthState("ard-1")?.failure?.reason).toBe("credential_rejected");
  });

  it("shares one login between concurrent callers", async () => {
    login.mockResolvedValue({ slug: "s" });
    const [a, b] = await Promise.all([settle(refreshArdAccount("ard-1", credentials)), settle(refreshArdAccount("ard-1", credentials))]);
    expect(a).toEqual(b);
    expect(login).toHaveBeenCalledTimes(1);
  });
});
