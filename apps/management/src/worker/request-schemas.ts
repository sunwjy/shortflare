import { z } from "zod";

/**
 * Strict transport schemas reject unknown fields before a command crosses
 * into a domain module. Domain validation remains in the receiving module.
 */
export const healthResponse = z.object({ status: z.literal("ok") });
export const setupRequest = z.strictObject({
  token: z.string(),
  password: z.string(),
});
export const loginRequest = z.strictObject({
  email: z.string(),
  password: z.string(),
});
export const invitationRequest = z.strictObject({
  email: z.string(),
  role: z.enum(["administrator", "member", "viewer"]),
});
export const tokenPasswordRequest = z.strictObject({
  token: z.string(),
  password: z.string(),
});
export const passwordRequest = z.strictObject({
  password: z.string(),
});
export const passwordChangeRequest = z.strictObject({
  currentPassword: z.string(),
  password: z.string(),
});
export const roleRequest = z.strictObject({
  role: z.enum(["administrator", "member", "viewer"]),
});
export const emptyRequest = z.strictObject({});
