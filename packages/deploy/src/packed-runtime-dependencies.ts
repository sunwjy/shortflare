import { z } from "zod";

const dependencyNodeSchema = z
  .object({
    version: z.string().optional(),
    dependencies: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export const productionDependencyPolicySchema = z.object({
  dependencies: z
    .array(
      z.object({
        path: z.array(z.string().min(1)).min(1),
        version: z.string().min(1),
      }),
    )
    .min(1),
});

export type ProductionDependencyPolicy = Readonly<{
  dependencies: readonly Readonly<{ path: readonly string[]; version: string }>[];
}>;

export function assertPackedRuntimeDependencies(
  rawTree: unknown,
  policy: ProductionDependencyPolicy,
): void {
  let node: unknown = rawTree;

  for (const expectation of policy.dependencies) {
    node = rawTree;
    const walked: string[] = [];
    for (const packageName of expectation.path) {
      walked.push(packageName);
      const parsed = dependencyNodeSchema.parse(node);
      const dependency = parsed.dependencies?.[packageName];
      if (dependency === undefined) {
        throw new Error(`Packed runtime dependency path is missing: ${walked.join(" > ")}`);
      }
      node = dependency;
    }

    const parsed = dependencyNodeSchema.parse(node);
    if (parsed.version !== expectation.version) {
      throw new Error(
        `Packed runtime dependency ${expectation.path.join(" > ")} resolved to ${parsed.version ?? "an unknown version"}; expected ${expectation.version}`,
      );
    }
  }
}
