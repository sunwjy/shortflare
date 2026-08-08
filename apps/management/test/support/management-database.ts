import { env } from "cloudflare:workers";

export async function resetIdentityDatabase() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM audit_events"),
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("DELETE FROM credentials"),
    env.DB.prepare("DELETE FROM invitations"),
    env.DB.prepare("DELETE FROM password_resets"),
    env.DB.prepare("DELETE FROM operator_recovery"),
    env.DB.prepare("DELETE FROM users"),
    env.DB.prepare("DELETE FROM initial_setup"),
    env.DB.prepare("UPDATE instances SET setup_completed_at = NULL WHERE singleton_key = 1"),
  ]);
}

export async function resetManagementDatabase() {
  await resetIdentityDatabase();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM analytics_rollups"),
    env.DB.prepare("DELETE FROM analytics_uniques"),
    env.DB.prepare("DELETE FROM analytics_events"),
    env.DB.prepare("DELETE FROM destination_versions"),
    env.DB.prepare("DELETE FROM aliases"),
    env.DB.prepare("DELETE FROM links"),
  ]);
}
