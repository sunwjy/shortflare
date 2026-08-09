import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, rename, unlink } from "node:fs/promises";
import path from "node:path";

const safeRelease = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export async function writeD1Backup(
  input: Readonly<{
    directory: string;
    sourceRelease: string;
    targetRelease: string;
    createdAt: Date;
    body: ReadableStream<Uint8Array>;
  }>,
): Promise<Readonly<{ path: string; sha256: string }>> {
  if (!safeRelease.test(input.sourceRelease) || !safeRelease.test(input.targetRelease)) {
    throw new Error("Backup release names must be valid semantic versions");
  }
  await mkdir(input.directory, { recursive: true, mode: 0o700 });
  await chmod(input.directory, 0o700);
  const timestamp = input.createdAt.toISOString().replaceAll(/[-:.]/g, "");
  const fileName = `${timestamp}_${input.sourceRelease}_to_${input.targetRelease}.sql`;
  const finalPath = path.join(input.directory, fileName);
  const temporaryPath = path.join(input.directory, `.${fileName}.${randomUUID()}.tmp`);
  const handle = await open(temporaryPath, "wx", 0o600);
  const digest = createHash("sha256");
  try {
    await copyStream(input.body.getReader(), handle, digest);
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, finalPath);
    await chmod(finalPath, 0o600);
    return { path: finalPath, sha256: digest.digest("hex") };
  } catch (error: unknown) {
    await handle.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function copyStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  handle: Awaited<ReturnType<typeof open>>,
  digest: ReturnType<typeof createHash>,
): Promise<void> {
  const chunk = await reader.read();
  if (chunk.done) return;
  digest.update(chunk.value);
  await handle.writeFile(chunk.value);
  return copyStream(reader, handle, digest);
}
