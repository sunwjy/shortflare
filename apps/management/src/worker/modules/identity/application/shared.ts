import { Buffer } from "node:buffer";

export type UserRole = "administrator" | "member" | "viewer";
export type UserState = "invited" | "active" | "suspended";

export type User = Readonly<{
  id: string;
  email: string;
  role: UserRole;
  state: UserState;
}>;

export function parseUserEmail(value: string) {
  const display = value.trim();
  const at = display.indexOf("@");
  const localPart = at >= 0 ? display.slice(0, at) : "";
  const domain = at >= 0 ? display.slice(at + 1) : "";
  if (
    display.length < 3 ||
    display.length > 254 ||
    at !== display.lastIndexOf("@") ||
    localPart.length < 1 ||
    localPart.length > 64 ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..") ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart) ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(
      domain,
    )
  ) {
    return undefined;
  }
  return { display, normalized: normalizeUserEmail(display) };
}

export function normalizeUserEmail(value: string) {
  return value.trim().toLowerCase();
}

export async function hashToken(token: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createRandomToken() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

export function toUser(record: User): User {
  return {
    id: record.id,
    email: record.email,
    role: record.role,
    state: record.state,
  };
}
