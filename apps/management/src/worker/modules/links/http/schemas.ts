import { z } from "zod";

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
