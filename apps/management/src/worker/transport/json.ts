import { z } from "zod";

export async function parseJson<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.output<Schema> | undefined> {
  try {
    const result = schema.safeParse(await request.json());
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
