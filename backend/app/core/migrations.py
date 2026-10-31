"""Apply Alembic migrations during startup for serverless deployments."""
from __future__ import annotations

import logging
import threading
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import text

from app.core.database import get_engine

logger = logging.getLogger(__name__)

# Serializes migration runs across Vercel function instances.
_ADVISORY_LOCK_ID = 728_310_001
_lock = threading.Lock()
_applied = False


def _alembic_config() -> Config:
    backend_dir = Path(__file__).resolve().parents[2]
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "migrations"))
    return config


def ensure_database_schema() -> None:
    global _applied
    if _applied:
        return
    with _lock:
        if _applied:
            return
        engine = get_engine()
        with engine.connect() as connection:
            connection.execute(text("SELECT pg_advisory_lock(:lock_id)"), {"lock_id": _ADVISORY_LOCK_ID})
            try:
                command.upgrade(_alembic_config(), "head")
            finally:
                connection.execute(text("SELECT pg_advisory_unlock(:lock_id)"), {"lock_id": _ADVISORY_LOCK_ID})
                connection.commit()
        _applied = True
        logger.info("Database schema is up to date")
