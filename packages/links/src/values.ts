import type { Alias, LinkResult } from "./types";

const aliasPattern = /^[A-Za-z0-9_-]{1,64}$/;
const aliasAlphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

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
