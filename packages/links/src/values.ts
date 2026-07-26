import type { Alias, LinkResult, PersistenceListQuery } from "./types";

const aliasPattern = /^[A-Za-z0-9_-]{1,64}$/;
const aliasAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const maximumDestinationLength = 8_192;

export function parseAlias(value: string): Alias | null {
  return aliasPattern.test(value) ? (value as Alias) : null;
}

export function generateRandomAlias(): string {
  const characters: string[] = [];
  while (characters.length < 6) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    for (const byte of bytes) {
      if (byte < 248) {
        characters.push(aliasAlphabet[byte % aliasAlphabet.length] ?? "");
        if (characters.length === 6) {
          break;
        }
      }
    }
  }

  return characters.join("");
}

export function mergeQuery(destination: string, incomingQuery: string): string {
  const url = new URL(destination);
  const storedNames = new Set(url.searchParams.keys());

  for (const [name, value] of new URLSearchParams(incomingQuery)) {
    if (!storedNames.has(name)) {
      url.searchParams.append(name, value);
    }
  }

  return url.href;
}

export function normalizeTitle(value: string): string | null {
  const title = value.trim();
  return title.length === 0 ||
    Array.from(title).length > 200 ||
    Array.from(title).some(isControlCharacter)
    ? null
    : title;
}

export function foldCase(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replaceAll("\u00df", "ss")
    .replaceAll("\u03c2", "\u03c3");
}

export function encodeListCursor(cursor: NonNullable<PersistenceListQuery["cursor"]>): string {
  const json = JSON.stringify({
    v: 1,
    updatedAt: cursor.updatedAt.getTime(),
    id: cursor.id,
  });
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeListCursor(
  value: string,
): NonNullable<PersistenceListQuery["cursor"]> | null {
  try {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/") + padding);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("v" in parsed) ||
      parsed.v !== 1 ||
      !("updatedAt" in parsed) ||
      !Number.isSafeInteger(parsed.updatedAt) ||
      (parsed.updatedAt as number) < 0 ||
      !("id" in parsed) ||
      typeof parsed.id !== "string" ||
      parsed.id.length === 0
    ) {
      return null;
    }

    return {
      updatedAt: new Date(parsed.updatedAt as number),
      id: parsed.id,
    };
  } catch {
    return null;
  }
}

export function validateDestination(
  value: string,
  redirectDomain: string,
):
  | Readonly<{ ok: true; destination: string }>
  | Extract<LinkResult, { kind: "invalid-destination" }> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, kind: "invalid-destination", reason: "malformed" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return {
      ok: false,
      kind: "invalid-destination",
      reason: "unsupported-protocol",
    };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, kind: "invalid-destination", reason: "credentials" };
  }
  if (normalizeHostname(url.hostname) === normalizeHostname(redirectDomain)) {
    return { ok: false, kind: "invalid-destination", reason: "redirect-loop" };
  }
  if (url.href.length > maximumDestinationLength) {
    return { ok: false, kind: "invalid-destination", reason: "too-long" };
  }

  return { ok: true, destination: url.href };
}

function isControlCharacter(character: string): boolean {
  const codePoint = character.codePointAt(0);
  return (
    codePoint !== undefined &&
    ((codePoint >= 0 && codePoint <= 31) ||
      (codePoint >= 127 && codePoint <= 159) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029)
  );
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}
