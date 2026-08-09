import { z } from "zod";

import { auditActions } from "../shared/audit";

export const userSchema = z.strictObject({
  id: z.string(),
  email: z.string(),
  role: z.enum(["administrator", "member", "viewer"]),
  state: z.enum(["invited", "active", "suspended"]),
});

export const identityUserResponseSchema = z.strictObject({
  ok: z.literal(true),
  kind: z.literal("user"),
  user: userSchema,
});

export const sessionResponseSchema = z.strictObject({
  ok: z.literal(true),
  user: userSchema,
  csrfToken: z.string(),
});

export const passwordChangedResponseSchema = z.strictObject({
  ok: z.literal(true),
  kind: z.literal("password-changed"),
});

export const invitationResponseSchema = z.strictObject({
  ok: z.literal(true),
  kind: z.literal("invitation"),
  invitation: z.strictObject({
    user: userSchema,
    token: z.string(),
    expiresAt: z.string(),
  }),
});

export const usersResponseSchema = z.strictObject({
  ok: z.literal(true),
  users: z.array(userSchema),
});

export const linkSchema = z.strictObject({
  id: z.string(),
  alias: z.string(),
  shortUrl: z.string(),
  title: z.string(),
  state: z.enum(["active", "disabled", "archived"]),
  revision: z.number().int().nonnegative(),
  destination: z.strictObject({
    id: z.string(),
    versionNumber: z.number().int().positive(),
    url: z.string(),
    createdAt: z.string(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const destinationVersionSchema = z.strictObject({
  id: z.string(),
  versionNumber: z.number().int().positive(),
  url: z.string(),
  createdAt: z.string(),
  current: z.boolean(),
});

export const reservedAliasSchema = z.strictObject({
  alias: z.string(),
  shortUrl: z.string(),
  deletedLinkId: z.string(),
  reservedAt: z.string(),
});

function pageSchema<Item extends z.ZodType>(item: Item) {
  return z.strictObject({
    ok: z.literal(true),
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

export const linksPageResponseSchema = pageSchema(linkSchema);
export const reservedAliasesPageResponseSchema = pageSchema(reservedAliasSchema);
export const destinationVersionsPageResponseSchema = pageSchema(destinationVersionSchema);

export const linkResponseSchema = z.strictObject({
  ok: z.literal(true),
  link: linkSchema,
});

export const linkMutationResponseSchema = z.strictObject({
  ok: z.literal(true),
  changed: z.boolean(),
  link: linkSchema,
});

export const deletedLinkResponseSchema = z.strictObject({
  ok: z.literal(true),
  reservedAlias: reservedAliasSchema,
});

const analyticsSummarySchema = z.strictObject({
  humanClicks: z.number().int().nonnegative(),
  uniqueHumanClicks: z.number().int().nonnegative(),
  suspectedBotClicks: z.number().int().nonnegative(),
});

const analyticsBreakdownSchema = z.strictObject({
  items: z.array(analyticsSummarySchema.extend({ value: z.string() })),
  truncated: z.boolean(),
});

const analyticsFields = {
  ok: z.literal(true),
  summary: analyticsSummarySchema,
  series: z.array(analyticsSummarySchema.extend({ bucket: z.string() })),
  breakdowns: z.strictObject({
    referrer: analyticsBreakdownSchema,
    country: analyticsBreakdownSchema,
    device: analyticsBreakdownSchema,
    bot: analyticsBreakdownSchema,
  }),
};

export const linkAnalyticsResponseSchema = z.strictObject({
  ...analyticsFields,
  topLinks: analyticsBreakdownSchema,
});

export const instanceAnalyticsResponseSchema = z.strictObject({
  ...analyticsFields,
  topLinks: z.strictObject({
    items: z.array(
      analyticsSummarySchema.extend({
        id: z.string(),
        alias: z.string(),
        shortUrl: z.string(),
        title: z.string(),
        state: z.enum(["active", "disabled", "archived"]),
      }),
    ),
    truncated: z.boolean(),
  }),
});

const auditMetadataSchema = z.strictObject({
  alias: z.string().optional(),
  changedFields: z.array(z.enum(["title", "destination"])).optional(),
  fromState: z.enum(["active", "disabled", "archived"]).optional(),
  toState: z.enum(["active", "disabled", "archived"]).optional(),
  destinationVersionId: z.string().optional(),
  fromRole: z.enum(["administrator", "member", "viewer"]).optional(),
  toRole: z.enum(["administrator", "member", "viewer"]).optional(),
  fromUserState: z.enum(["invited", "active", "suspended"]).optional(),
  toUserState: z.enum(["invited", "active", "suspended"]).optional(),
  analyticsDate: z.string().optional(),
});

export const auditEventsPageResponseSchema = pageSchema(
  z.strictObject({
    id: z.string(),
    occurredAt: z.string(),
    actor: z.strictObject({ id: z.string(), display: z.string().nullable() }),
    action: z.enum(auditActions),
    subject: z.strictObject({
      id: z.string(),
      kind: z.enum(["instance", "link", "user"]),
      display: z.string().nullable(),
    }),
    metadata: auditMetadataSchema,
  }),
);
