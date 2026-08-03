import { z } from "zod";

/**
 * Strict transport schemas reject unknown fields before a command crosses
 * into a domain module. Domain validation remains in the receiving module.
 */
export const healthResponse = z.object({ status: z.literal("ok") });
