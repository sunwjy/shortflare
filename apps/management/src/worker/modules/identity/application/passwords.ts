import { Buffer } from "node:buffer";
import { scrypt, timingSafeEqual } from "node:crypto";

type ScryptPolicy = Readonly<{
  N: number;
  r: number;
  p: number;
  outputLength: number;
  maxmem: number;
}>;

// ADR-0003 fixes the current cost and requires a whitelist for legacy
// verifiers, so stored parameters can never select arbitrary KDF work factors.
const currentPolicy: ScryptPolicy = {
  N: 32_768,
  r: 8,
  p: 1,
  outputLength: 32,
  maxmem: 48 * 1_024 * 1_024,
};
const acceptedPolicies = new Map([
  ["N=32768,r=8,p=1,l=32", currentPolicy],
  [
    "N=16384,r=8,p=1,l=32",
    {
      N: 16_384,
      r: 8,
      p: 1,
      outputLength: 32,
      maxmem: 32 * 1_024 * 1_024,
    },
  ],
]);
const currentParameters = "N=32768,r=8,p=1,l=32";
const blockedPasswords = new Set([
  "123456789012345",
  "correct horse battery staple",
  "letmeinletmeinletmein",
  "passwordpassword",
  "qwertyuiopasdfgh",
]);

export const dummyVerifier =
  "scrypt$v=1$N=32768,r=8,p=1,l=32$BwcHBwcHBwcHBwcHBwcHBw$5ZN-eW8mCOZ-tc6XvKT-cn5aLMwFQ-hPtgjaL-IM0-0";

export async function createPasswordVerifier(password: string) {
  const normalized = normalizeAllowedPassword(password);
  if (!normalized || blockedPasswords.has(normalized)) {
    return undefined;
  }

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const tag = await derive(normalized, salt, currentPolicy);
  return `scrypt$v=1$${currentParameters}$${Buffer.from(salt).toString("base64url")}$${Buffer.from(tag).toString("base64url")}`;
}

export async function verifyPassword(password: string, verifier: string) {
  const normalized = normalizeAllowedPassword(password);
  const parsed = normalized ? parseVerifier(verifier) : undefined;
  if (!normalized || !parsed) {
    return { valid: false, needsRehash: false } as const;
  }
  const actual = await derive(normalized, parsed.salt, parsed.policy);
  return {
    valid: actual.length === parsed.tag.length && timingSafeEqual(actual, parsed.tag),
    needsRehash: parsed.parameters !== currentParameters,
  } as const;
}

function normalizeAllowedPassword(password: string) {
  const normalized = password.normalize("NFC");
  const length = Array.from(normalized).length;
  return length >= 15 && length <= 128 ? normalized : undefined;
}

function parseVerifier(verifier: string) {
  const match = /^scrypt\$v=1\$(N=\d+,r=\d+,p=\d+,l=\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/.exec(
    verifier,
  );
  const parameters = match?.[1];
  const policy = parameters ? acceptedPolicies.get(parameters) : undefined;
  if (!parameters || !policy || !match?.[2] || !match[3]) {
    return undefined;
  }
  const salt = Buffer.from(match[2], "base64url");
  const tag = Buffer.from(match[3], "base64url");
  if (salt.length !== 16 || tag.length !== policy.outputLength) {
    return undefined;
  }
  return {
    parameters,
    policy,
    salt: new Uint8Array(salt),
    tag: new Uint8Array(tag),
  };
}

function derive(password: string, salt: Uint8Array, policy: ScryptPolicy) {
  return new Promise<Uint8Array>((resolve, reject) => {
    scrypt(
      new TextEncoder().encode(password),
      salt,
      policy.outputLength,
      {
        N: policy.N,
        r: policy.r,
        p: policy.p,
        maxmem: policy.maxmem,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
        } else {
          resolve(new Uint8Array(derivedKey));
        }
      },
    );
  });
}
