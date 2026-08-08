import { halfHourBucket } from "./event-policy";

export const CLICK_EVENT_SCHEMA_VERSION = 1 as const;
export const CLICK_EVENT_CLASSIFICATION_VERSION = 1 as const;

export type BotClassification = "human" | "suspected-bot";
export type DeviceCategory = "desktop" | "mobile" | "tablet" | "other" | "unknown";

export type ClickEvent = Readonly<{
  schemaVersion: typeof CLICK_EVENT_SCHEMA_VERSION;
  classificationVersion: typeof CLICK_EVENT_CLASSIFICATION_VERSION;
  eventId: string;
  linkId: string;
  destinationVersionId: string;
  occurredAt: string;
  pseudonymousVisitor: string;
  botClassification: BotClassification;
  referrerDomain: string;
  country: string;
  deviceCategory: DeviceCategory;
}>;

export type ClickObservation = Readonly<{
  linkId: string;
  destinationVersionId: string;
  clientIp: string | null;
  userAgent: string | null;
  referrer: string | null;
  country: string | null;
}>;

export type ClickRecordResult = Readonly<{
  kind: "recorded";
  eventId: string;
}>;

export type ClickEventDelivery = Readonly<{
  deliver(event: ClickEvent): Promise<void>;
}>;

export type ClickAnalytics = Readonly<{
  record(input: ClickObservation): Promise<ClickRecordResult>;
}>;

type ClickAnalyticsDependencies = Readonly<{
  hmacKey: string;
  delivery: ClickEventDelivery;
  now?: () => Date;
  randomId?: () => string;
}>;

const suspectedBotPattern =
  /bot|crawler|spider|slurp|preview|unfurl|headless|phantom|selenium|curl|wget|python-requests|httpclient|facebookexternalhit|whatsapp|telegram|discord|slack/i;
const tabletPattern = /ipad|tablet|kindle|silk/i;
const mobilePattern = /mobile|iphone|ipod|android.*mobile|windows phone/i;
const desktopBrowserPattern = /mozilla|chrome|chromium|safari|firefox|edg\//i;
const isoCountryCodes = new Set(
  `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW`.split(
    " ",
  ),
);

export function isAnalyticsCountry(value: string): boolean {
  return value === "unknown" || isoCountryCodes.has(value);
}

export function isAnalyticsReferrerDomain(value: string): boolean {
  if (value === "direct" || value === "unknown") return true;
  if (value.length === 0 || value.length > 253 || value !== value.toLowerCase()) return false;
  if (!/^[\x21-\x7E]+$/.test(value)) return false;
  try {
    return new URL(`https://${value}`).hostname === value;
  } catch {
    return false;
  }
}

export function createClickAnalytics(dependencies: ClickAnalyticsDependencies): ClickAnalytics {
  const keyBytes = decodeHmacKey(dependencies.hmacKey);
  const now = dependencies.now ?? (() => new Date());
  const randomId = dependencies.randomId ?? (() => crypto.randomUUID());

  return {
    async record(input) {
      const occurredAt = now();
      const eventId = randomId();
      const event: ClickEvent = {
        schemaVersion: CLICK_EVENT_SCHEMA_VERSION,
        classificationVersion: CLICK_EVENT_CLASSIFICATION_VERSION,
        eventId,
        linkId: input.linkId,
        destinationVersionId: input.destinationVersionId,
        occurredAt: occurredAt.toISOString(),
        pseudonymousVisitor: await derivePseudonymousVisitor(
          keyBytes,
          input.linkId,
          occurredAt,
          input.clientIp,
          input.userAgent,
        ),
        botClassification: classifyBot(input.clientIp, input.userAgent),
        referrerDomain: normalizeReferrerDomain(input.referrer),
        country: normalizeCountry(input.country),
        deviceCategory: classifyDevice(input.userAgent),
      };

      await dependencies.delivery.deliver(event);
      return { kind: "recorded", eventId };
    },
  };
}

function decodeHmacKey(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error("ANALYTICS_HMAC_KEY must be a base64url-encoded 256-bit value");
  }
  const padded = `${value.replaceAll("-", "+").replaceAll("_", "/")}=`;
  const decoded = atob(padded);
  const bytes = Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  if (bytes.byteLength !== 32) {
    throw new Error("ANALYTICS_HMAC_KEY must decode to 32 bytes");
  }
  return bytes;
}

async function derivePseudonymousVisitor(
  keyBytes: Uint8Array,
  linkId: string,
  occurredAt: Date,
  clientIp: string | null,
  userAgent: string | null,
): Promise<string> {
  const framedInput = JSON.stringify([
    linkId,
    halfHourBucket(occurredAt),
    clientIp ?? "",
    userAgent ?? "",
  ]);
  const keyData = new ArrayBuffer(keyBytes.byteLength);
  new Uint8Array(keyData).set(keyBytes);
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(framedInput)),
  );
  return toBase64Url(signature);
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function classifyBot(clientIp: string | null, userAgent: string | null): BotClassification {
  if (clientIp === null || userAgent === null || userAgent.trim() === "") {
    return "suspected-bot";
  }
  return suspectedBotPattern.test(userAgent) ? "suspected-bot" : "human";
}

function classifyDevice(userAgent: string | null): DeviceCategory {
  if (userAgent === null || userAgent.trim() === "") {
    return "unknown";
  }
  if (tabletPattern.test(userAgent)) {
    return "tablet";
  }
  if (mobilePattern.test(userAgent)) {
    return "mobile";
  }
  if (desktopBrowserPattern.test(userAgent)) {
    return "desktop";
  }
  return "other";
}

function normalizeReferrerDomain(referrer: string | null): string {
  if (referrer === null || referrer.trim() === "") {
    return "direct";
  }
  try {
    const url = new URL(referrer);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.hostname === "") {
      return "unknown";
    }
    return url.hostname.toLowerCase();
  } catch {
    return "unknown";
  }
}

function normalizeCountry(country: string | null): string {
  const normalized = country?.trim().toUpperCase() ?? "";
  if (!isAnalyticsCountry(normalized)) {
    return "unknown";
  }
  return normalized;
}
