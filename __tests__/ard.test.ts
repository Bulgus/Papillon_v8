import { beforeEach, describe, expect, it, jest } from "@jest/globals";

import { ArdAuthenticationError, ArdClient, normalizeArdSchoolId } from "@/services/ard/client";

/**
 * A fake ARD portal (TYPO3 felogin): login form with hidden fields, an
 * HttpOnly session cookie, pages carrying `gecData`, and JSON eIDs.
 */
const SESSION = "fe_typo_user=abc123";
const LOGIN_PAGE = `
<form method="post" action="/fr/espaces-clients/etablissements/clisson-aime_cesaire/accueil.html?tx_felogin_login%5Baction%5D=login&amp;tx_felogin_login%5Bcontroller%5D=Login">
  <input type="hidden" name="logintype" value="login" />
  <input type="hidden" name="pid" value="42@abc" />
  <input type="hidden" name="__RequestToken" value="tok&amp;en" />
  <input type="text" name="user" /><input type="password" name="pass" />
</form>`;
const LOGGED_IN = `<a href="?logintype=logout">Déconnexion</a>
  <a href="/fr/espaces-clients/etablissements/clisson-aime-cesaire/menu-utilisateur/accueil.html">Menu</a>
  <img alt="Lycée Aimé Césaire" src="/fileadmin/users/logo.png">`;
const GEC = (uid: number) => `<script>var gecData = ${JSON.stringify({
  user: { uid, firstName: "Aimé", lastName: "C", isGuardian: false, isComensal: true },
  walletData: [{ ownerUid: uid, walletUid: 1, walletOrid: 2, walletName: "Restauration", walletBalance: 1234 }],
})};</script>`;

type Init = { method?: string; headers?: Record<string, string>; body?: string };
const response = (body: string, status = 200, cookie?: string) => ({
  status,
  ok: status < 400,
  headers: { get: (name: string) => (name.toLowerCase() === "set-cookie" ? cookie ?? null : null) },
  text: async () => body,
});

let sessionValid = true;
let qr: Record<string, unknown> = { success: 1, code: btoa("ARD-123456"), codeInfoFn: "Aimé", codeInfoLn: "C" };
const calls: Array<{ url: string; init: Init }> = [];

const portal = jest.fn(async (url: string, init: Init = {}) => {
  calls.push({ url, init });
  const cookie = init.headers?.Cookie ?? "";
  const authed = cookie.includes(SESSION) && sessionValid;
  if (url.includes("/introuvable/")) {return response("Not found", 404);}
  if (init.method === "POST") {
    const body = new URLSearchParams(init.body);
    if (body.get("user") === "E00000" && body.get("pass") === "secret" && body.get("pid") === "42@abc" && body.get("__RequestToken") === "tok&en") {
      sessionValid = true;
      return response(LOGGED_IN, 200, `${SESSION}; path=/; HttpOnly, other=1; path=/`);
    }
    return response(LOGIN_PAGE);
  }
  if (url.includes("eID=qrcode_record_eid")) {return response(authed ? JSON.stringify(qr) : "LOGOFF");}
  if (url.includes("eID=consumption_history_eid")) {
    if (!authed) {return response("LOGOFF");}
    const page = Number(new URL(url).searchParams.get("page"));
    const rows = Array.from({ length: page < 3 ? 10 : 3 }, (_, i) => ({ consumption_uid: page * 100 + i, amount: 330 }));
    return response(JSON.stringify({ total: 23, consumptions: rows }));
  }
  if (url.includes("/menu-utilisateur/")) {return response(authed ? GEC(77) : LOGIN_PAGE);}
  if (url.includes("/accueil.html")) {return response(authed ? LOGGED_IN : LOGIN_PAGE);}
  return response("?", 404);
});

beforeEach(() => {
  calls.length = 0;
  sessionValid = true;
  portal.mockClear();
  global.fetch = portal as unknown as typeof fetch;
});

describe("ARD: school id", () => {
  it.each([
    ["clisson-aime_cesaire", "clisson-aime_cesaire"],
    [" https://services.ard.fr/fr/espaces-clients/etablissements/clisson-aime_cesaire.html ", "clisson-aime_cesaire"],
    ["https://services.ard.fr/fr/espaces-clients/etablissements/clisson-aime_cesaire/accueil.html?x=1#top", "clisson-aime_cesaire"],
  ])("normalises %s", (input, expected) => {
    expect(normalizeArdSchoolId(input)).toBe(expected);
  });
});

describe("ARD: login", () => {
  it("posts the form with its hidden fields and keeps the HttpOnly cookie", async () => {
    const client = await ArdClient.login("clisson-aime_cesaire", "E00000", "secret");
    const post = calls.find(call => call.init.method === "POST")!;
    expect(post.url).toContain("tx_felogin_login%5Baction%5D=login&tx_felogin_login");
    expect(client.slug).toBe("clisson-aime-cesaire");
    expect(client.schoolName).toBe("Lycée Aimé Césaire");

    await client.getAccount();
    const page = calls[calls.length - 1];
    expect(page.url).toContain("/clisson-aime-cesaire/menu-utilisateur/paiement-en-ligne.html");
    expect(page.init.headers?.Cookie).toContain(SESSION);
    expect(page.init.headers?.Cookie).toContain("other=1");
  });

  it("rejects wrong credentials with a dedicated error", async () => {
    await expect(ArdClient.login("clisson-aime_cesaire", "E00000", "wrong")).rejects.toBeInstanceOf(ArdAuthenticationError);
  });

  it("says when the school does not exist", async () => {
    await expect(ArdClient.login("introuvable", "u", "p")).rejects.toThrow("Établissement ARD introuvable (404).");
  });
});

describe("ARD: data", () => {
  it("reads the account and wallets", async () => {
    const client = await ArdClient.login("clisson-aime_cesaire", "E00000", "secret");
    const data = await client.getAccount();
    expect(data.user.uid).toBe(77);
    expect(data.walletData?.[0]).toMatchObject({ walletName: "Restauration", walletBalance: 1234 });
  });

  it("follows the portal's 10-row pages", async () => {
    const client = await ArdClient.login("clisson-aime_cesaire", "E00000", "secret");
    const consumptions = await client.getConsumptions();
    expect(consumptions).toHaveLength(23);
    expect(consumptions[0].consumption_uid).toBe(100);
  });

  it("logs in again when the session expired", async () => {
    const client = await ArdClient.login("clisson-aime_cesaire", "E00000", "secret");
    await client.getAccount();
    sessionValid = false;
    const result = await client.getQRCode();
    expect(result).toEqual({ enabled: true, code: "ARD-123456", firstName: "Aimé", lastName: "C" });
    expect(calls.filter(call => call.init.method === "POST")).toHaveLength(2);
  });

  it("explains why the QR code is unavailable", async () => {
    qr = { success: 0, code: "error_qrcode_disabled" };
    const client = await ArdClient.login("clisson-aime_cesaire", "E00000", "secret");
    const result = await client.getQRCode();
    expect(result.enabled).toBe(false);
    if (!result.enabled) {expect(result.reason).toContain("pas activée");}
  });
});
