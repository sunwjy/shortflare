import { env } from "cloudflare:workers";

export async function resetDatabase() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM audit_events"),
    env.DB.prepare("DELETE FROM destination_versions"),
    env.DB.prepare("DELETE FROM aliases"),
    env.DB.prepare("DELETE FROM links"),
  ]);
}
