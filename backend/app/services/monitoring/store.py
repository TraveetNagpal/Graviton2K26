"""Small durable SQLite store for scheduled monitoring configurations and results."""
from __future__ import annotations

import json
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


def _path() -> str:
    return os.getenv("MONITOR_DB_PATH", "terramind_monitoring.sqlite3")


def connect():
    path = _path()
    if path != ":memory:":
        Path(path).expanduser().parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=15)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.execute("PRAGMA busy_timeout=15000")
    return db


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def init_store():
    with connect() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS monitors (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, config TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL, next_run_at TEXT NOT NULL,
          last_checked_at TEXT, last_success_at TEXT, baseline_date TEXT,
          baseline_image_id TEXT, baseline_dataset TEXT, consecutive_failures INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS monitor_runs (
          id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
          status TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
          observation_date TEXT, analysis_id TEXT, result TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 1
        );
        CREATE INDEX IF NOT EXISTS monitor_runs_monitor_idx ON monitor_runs(monitor_id, started_at DESC);
        CREATE TABLE IF NOT EXISTS monitor_alerts (
          id TEXT PRIMARY KEY, monitor_id TEXT NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
          run_id TEXT NOT NULL REFERENCES monitor_runs(id) ON DELETE CASCADE,
          category TEXT NOT NULL, observation_date TEXT NOT NULL, created_at TEXT NOT NULL,
          summary TEXT NOT NULL, measurement TEXT NOT NULL, layer_url TEXT,
          verification_status TEXT NOT NULL DEFAULT 'pending', fingerprint TEXT NOT NULL UNIQUE
        );
        CREATE INDEX IF NOT EXISTS monitor_alerts_created_idx ON monitor_alerts(created_at DESC);
        CREATE TABLE IF NOT EXISTS monitor_notifications (
          id TEXT PRIMARY KEY, alert_id TEXT NOT NULL REFERENCES monitor_alerts(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL, read_at TEXT
        );
        """)


def row_json(row):
    return dict(row) if row is not None else None


def decoded(row, field, default=None):
    if row is None:
        return default
    try:
        return json.loads(row[field])
    except (KeyError, TypeError, json.JSONDecodeError):
        return default


def json_dump(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)
