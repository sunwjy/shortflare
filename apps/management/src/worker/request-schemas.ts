import { z } from "zod";

/**
 * Strict transport schemas reject unknown fields before a command crosses
 * into a domain module. Domain validation remains in the receiving module.
 */
export const healthResponse = z.object({ status: z.literal("ok") });
export const createLinkRequest = z.strictObject({
  alias: z.string().optional(),
  title: z.string(),
  destination: z.string(),
});
export const editLinkRequest = z
  .strictObject({
    expectedRevision: z.number().int().nonnegative(),
    title: z.string().optional(),
    destination: z.string().optional(),
  })
  .refine((request) => request.title !== undefined || request.destination !== undefined);
export const revisionRequest = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
});
export const permanentDeleteRequest = z.strictObject({
  expectedRevision: z.number().int().nonnegative(),
  confirmationAlias: z.string(),
});
export const confirmationRequest = z.strictObject({
  confirmationAlias: z.string(),
});
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
