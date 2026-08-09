import { createHash } from "node:crypto";

import { z } from "zod";

const semverSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/);
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const packageRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.includes("\\") &&
      value.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".."),
    "Artifact path must stay within the package",
  );

const artifactSchema = z.strictObject({
  path: packageRelativePathSchema,
  sha256: sha256Schema,
});
const migrationNameSchema = z.string().regex(/^\d{4}_[a-z0-9_]+\.sql$/);

const releaseManifestSchema = z.strictObject({
  formatVersion: z.literal(1),
  release: semverSchema,
  schema: z.strictObject({
    version: z.number().int().nonnegative(),
    journalSha256: sha256Schema,
    migrations: z.array(migrationNameSchema).min(1),
  }),
  supportedSources: z.array(z.union([z.literal("fresh"), semverSchema])).min(1),
  rollbackSafeFrom: z.array(semverSchema),
  artifacts: z.strictObject({
    management: artifactSchema,
    redirect: artifactSchema,
    migrations: artifactSchema,
  }),
});

export type ReleaseManifest = Readonly<z.infer<typeof releaseManifestSchema>>;

export type ReleaseManifestIssue = Readonly<{
  path: string;
  message: string;
}>;

export type ParseReleaseManifestResult =
  | Readonly<{ ok: true; value: ReleaseManifest }>
  | Readonly<{
      ok: false;
      kind: "invalid-release-manifest";
      issues: readonly ReleaseManifestIssue[];
    }>;

export function parseReleaseManifest(input: unknown): ParseReleaseManifestResult {
  const parsed = releaseManifestSchema.safeParse(input);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }

  return {
    ok: false,
    kind: "invalid-release-manifest",
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

export function hashReleaseManifest(manifest: ReleaseManifest): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}
