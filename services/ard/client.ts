/**
 * Minimal client for the ARD "Espace monétique" portal (services.ard.fr).
 *
 * ARD moved its login to the TYPO3 v10+ `felogin` plugin (plain password,
 * `__trustedProperties`/`__referrer` hidden fields, no MD5 challenge), which
 * broke `@blockshub/blocksrd`. History endpoints were renamed too
 * (`consumption_history_eid`, `financial_history_eid`, `order_history_eid`).
 */

const HOST = "https://services.ard.fr";
const SCHOOLS_PATH = "/fr/espaces-clients/etablissements";
const USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

export class ArdAuthenticationError extends Error {
  constructor(message = "Identifiant ou mot de passe ARD incorrect.") {
    super(message);
    this.name = "ArdAuthenticationError";
  }
}

export interface ArdUser {
  uid: number;
  firstName: string;
  lastName: string;
  email?: string;
  isGuardian: boolean;
  isComensal: boolean;
  children?: Array<{ uid: number; firstName: string; lastName: string }>;
}

export interface ArdWallet {
  ownerUid: number;
  walletUid: number;
  walletOrid: number;
  walletName: string;
  /** Cents. */
  walletAmount: number;
  updateTimeStamp: number;
}

export interface ArdGecData {
  user: ArdUser;
  walletData?: ArdWallet[];
  sessionDuration?: number;
}

export interface ArdConsumption {
  consumption_uid: number;
  /** Seconds. */
  consumptionDate: number;
  consumptionDescription: string;
  /** Cents. */
  amount: number;
  eWalletName: string;
}

export interface ArdOperation {
  operation_uid: number;
  operationDate: number;
  operationName: string;
  eWalletName: string;
  paymentMethod: string;
  credit: number | null;
  debit: number | null;
}

export interface ArdOrder {
  order_uid: number;
  orderDate: number;
  orderReference: number;
  state: number;
  amount: number;
}

export type ArdQRCodeResult =
  | { enabled: true; code: string; firstName?: string; lastName?: string }
  | { enabled: false; reason: string };

const QR_ERRORS: Record<string, string> = {
  error_qrcode_disabled: "L'identification par QR Code n'est pas activée par ton établissement.",
  error_qrcode_nocredit: "Le QR Code ne peut pas être généré : le crédit de ton établissement est épuisé.",
  error_qrcode_nosmart: "Ton identifiant n'est pas connu du portail ARD, contacte ton établissement.",
  error_qrcode_disallow: "Ta catégorie n'est pas autorisée à utiliser le QR Code.",
};

/**
 * Accepts a bare school id ("clisson-aime_cesaire") or any portal URL
 * ("https://services.ard.fr/fr/espaces-clients/etablissements/clisson-aime_cesaire.html").
 */
export function normalizeArdSchoolId(input: string): string {
  let value = input.trim();
  const marker = "/etablissements/";
  const index = value.indexOf(marker);
  if (index !== -1) {
    value = value.slice(index + marker.length);
  }
  value = value.split(/[?#]/)[0];
  value = value.split("/")[0];
  return value.replace(/\.html$/i, "").trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function extractGecData(html: string): ArdGecData | null {
  const match = html.match(/gecData\s*=\s*(\{[\s\S]*?\})\s*;?\s*<\/script>/);
  if (!match) {return null;}
  try {
    return JSON.parse(match[1]) as ArdGecData;
  } catch {
    return null;
  }
}

interface HttpResponse {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

type HttpFetch = (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<HttpResponse>;

/**
 * On iOS, React Native's fetch leaves cookies to the system cookie jar and
 * does not hand HttpOnly Set-Cookie headers to JS, so the portal's session
 * cookie (fe_typo_user, HttpOnly) was lost after login. expo-fetcher's native
 * fetch never touches the jar and returns every Set-Cookie: cookies are then
 * handled here, like on a server. Plain fetch elsewhere (tests).
 */
let httpFetch: HttpFetch | null = null;
function getHttpFetch(): HttpFetch {
  if (httpFetch) {return httpFetch;}
  const isReactNative = typeof navigator !== "undefined" && (navigator as { product?: string }).product === "ReactNative";
  if (isReactNative) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const native = require("expo-fetcher") as { fetch?: HttpFetch };
      if (native?.fetch) {
        httpFetch = native.fetch;
        return httpFetch;
      }
    } catch {
      // module unavailable: fall back to fetch
    }
  }
  httpFetch = (url, init) => fetch(url, { ...init, credentials: "omit" }) as Promise<HttpResponse>;
  return httpFetch;
}

function isLoggedIn(html: string): boolean {
  return html.includes("logintype=logout") && !html.includes("name=\"pass\"");
}

export class ArdClient {
  private cookies = new Map<string, string>();
  /** Canonical slug used by the portal pages (may differ from the login id, e.g. "_" → "-"). */
  public slug: string;
  public schoolName = "";
  public user: ArdUser | null = null;

  constructor(
    public readonly schoolId: string,
    private readonly username: string,
    private readonly password: string
  ) {
    this.schoolId = normalizeArdSchoolId(schoolId);
    this.slug = this.schoolId;
  }

  static async login(schoolId: string, username: string, password: string): Promise<ArdClient> {
    const client = new ArdClient(schoolId, username, password);
    await client.login();
    return client;
  }

  private storeCookies(response: HttpResponse) {
    const header = response.headers.get("set-cookie");
    if (!header) {return;}
    // Several cookies may be folded in a single header, separated by commas.
    for (const part of header.split(/,(?=\s*[A-Za-z0-9_\-]+=)/)) {
      const [pair] = part.trim().split(";");
      const eq = pair.indexOf("=");
      if (eq > 0) {
        this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      }
    }
  }

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  private async request(
    url: string,
    init: { method?: string; headers?: Record<string, string>; body?: string } = {}
  ): Promise<HttpResponse> {
    const headers: Record<string, string> = {
      "User-Agent": USER_AGENT,
      "Cache-Control": "no-cache",
      ...(init.headers ?? {}),
    };
    const cookie = this.cookieHeader();
    if (cookie) {headers.Cookie = cookie;}
    const response = await getHttpFetch()(url.startsWith("http") ? url : HOST + url, {
      method: init.method ?? "GET",
      headers,
      body: init.body,
    });
    this.storeCookies(response);
    return response;
  }

  /** Short description of the session state, for error messages. */
  private describeSession(status: number, html: string): string {
    const names = [...this.cookies.keys()].join(",") || "aucun cookie";
    const state = isLoggedIn(html) ? "connecté" : html.includes("name=\"pass\"") ? "page de connexion" : "page inattendue";
    return `HTTP ${status}, ${state}, ${names}`;
  }

  async login(): Promise<void> {
    this.cookies.clear();
    const homeUrl = `${HOST}${SCHOOLS_PATH}/${this.schoolId}/accueil.html`;
    const home = await this.request(homeUrl);
    if (!home.ok) {
      throw new Error(`Établissement ARD introuvable (${home.status}).`);
    }
    const html = await home.text();

    if (isLoggedIn(html)) {
      // Native cookie jar already holds a valid session: log out first so we
      // never reuse someone else's session.
      await this.request(`${HOST}${SCHOOLS_PATH}/${this.schoolId}/accueil.html?logintype=logout`);
      return this.loginFromHtml(await (await this.request(homeUrl)).text());
    }
    return this.loginFromHtml(html);
  }

  private async loginFromHtml(html: string): Promise<void> {
    const formMatch = html.match(/<form[^>]*action="([^"]*tx_felogin_login[^"]*)"[^>]*>([\s\S]*?)<\/form>/);
    const params = new URLSearchParams();
    let action: string;

    if (formMatch) {
      action = decodeEntities(formMatch[1]);
      const inputRegex = /<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"[^>]*>/g;
      let input: RegExpExecArray | null;
      while ((input = inputRegex.exec(formMatch[2])) !== null) {
        params.set(decodeEntities(input[1]), decodeEntities(input[2]));
      }
    } else {
      // Very old portal layout fallback.
      action = `${SCHOOLS_PATH}/${this.schoolId}/accueil.html?no_cache=1`;
      const pid = html.match(/name="pid" value="([^"]*)"/)?.[1];
      if (pid) {params.set("pid", pid);}
      params.set("logintype", "login");
    }

    params.set("user", this.username);
    params.set("pass", this.password);
    params.set("submit", "VALIDER");

    const response = await this.request(action, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    });
    const result = await response.text();

    if (!isLoggedIn(result)) {
      throw new ArdAuthenticationError();
    }

    const slug = result.match(/\/etablissements\/([^/"']+)\/menu-utilisateur\//)?.[1];
    if (slug) {this.slug = slug;}
    const name = result.match(/<img alt="([^"]+)" src="\/fileadmin\/users\//)?.[1];
    if (name) {this.schoolName = decodeEntities(name);}
  }

  private pageUrl(page: string) {
    return `${HOST}${SCHOOLS_PATH}/${this.slug}/menu-utilisateur/${page}.html?no_cache=1`;
  }

  /** Fetch a page and re-login once if the session expired. */
  private async fetchGecData(page: string, retry = true): Promise<ArdGecData> {
    const response = await this.request(this.pageUrl(page));
    const html = await response.text();
    const data = extractGecData(html);
    if (data?.user?.uid) {
      this.user = data.user;
      return data;
    }
    if (retry) {
      await this.login();
      return this.fetchGecData(page, false);
    }
    throw new Error(`Session ARD invalide (${this.describeSession(response.status, html)}).`);
  }

  private async fetchJson<T>(eid: string, query: Record<string, string | number>, retry = true): Promise<T> {
    const qs = new URLSearchParams({ eID: eid });
    for (const [key, value] of Object.entries(query)) {qs.set(key, String(value));}
    const response = await this.request(`${HOST}/?${qs.toString()}`, {
      headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json" },
    });
    const text = await response.text();
    if ((text.trim() === "LOGOFF" || response.status === 401) && retry) {
      await this.login();
      return this.fetchJson(eid, query, false);
    }
    return JSON.parse(text) as T;
  }

  async getAccount(): Promise<ArdGecData> {
    return this.fetchGecData("paiement-en-ligne");
  }

  async getUid(): Promise<number> {
    if (this.user?.uid) {return this.user.uid;}
    return (await this.getAccount()).user.uid;
  }

  private range(days: number) {
    const end = Math.round(Date.now() / 1000) + 24 * 60 * 60;
    return { startTimestamp: end - days * 24 * 60 * 60, endTimestamp: end };
  }

  /** The portal serves 10 rows per page whatever `limit` says. */
  private async paginate<T>(eid: string, key: string, days: number, max: number): Promise<T[]> {
    const uid = await this.getUid();
    const range = this.range(days);
    const items: T[] = [];
    for (let page = 1; items.length < max && page <= 50; page++) {
      const data = await this.fetchJson<Record<string, unknown>>(eid, {
        fe_uid: uid, ...range, page, start: (page - 1) * 10, limit: 10,
      });
      const rows = (data[key] as T[] | undefined) ?? [];
      items.push(...rows);
      const total = Number(data.total ?? 0);
      if (rows.length === 0 || items.length >= total) {break;}
    }
    return items.slice(0, max);
  }

  async getConsumptions(days = 365, limit = 200): Promise<ArdConsumption[]> {
    return this.paginate<ArdConsumption>("consumption_history_eid", "consumptions", days, limit);
  }

  async getOperations(days = 365, limit = 200): Promise<ArdOperation[]> {
    return this.paginate<ArdOperation>("financial_history_eid", "operations", days, limit);
  }

  async getOrders(days = 365, limit = 200): Promise<ArdOrder[]> {
    try {
      return await this.paginate<ArdOrder>("order_history_eid", "orders", days, limit);
    } catch {
      return [];
    }
  }

  async getQRCode(): Promise<ArdQRCodeResult> {
    const uid = await this.getUid();
    const data = await this.fetchJson<{ success: number | string; code?: string; codeInfoFn?: string; codeInfoLn?: string }>(
      "qrcode_record_eid",
      { fe_uid: uid, mobile: 1, start: 0, limit: 50 }
    );
    if (String(data.success) === "1" && data.code) {
      return { enabled: true, code: atob(data.code), firstName: data.codeInfoFn, lastName: data.codeInfoLn };
    }
    const code = String(data.code ?? "");
    return { enabled: false, reason: QR_ERRORS[code] ?? "QR Code indisponible." };
  }
}
