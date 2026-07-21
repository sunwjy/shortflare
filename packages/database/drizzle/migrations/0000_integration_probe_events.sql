CREATE TABLE integration_probe_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  emitted_at TEXT NOT NULL,
  consumed_at TEXT NOT NULL
);
