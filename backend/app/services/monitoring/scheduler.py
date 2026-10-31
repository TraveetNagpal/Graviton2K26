"""Lightweight single-process scheduler. Use a shared worker queue when scaling horizontally."""
import logging
import os
from threading import Event, Thread

from .service import run_due_monitors
from .store import init_store

logger = logging.getLogger(__name__)
_stop = Event()
_thread = None


def _setting(name, default, minimum, maximum):
    try:
        return min(maximum, max(minimum, int(os.getenv(name, str(default)))))
    except ValueError:
        logger.warning("Invalid %s value; using default %s", name, default)
        return default


def _loop():
    interval = _setting("MONITOR_SCHEDULER_POLL_SECONDS", 60, 15, 3600)
    batch = _setting("MONITOR_SCHEDULER_BATCH_SIZE", 2, 1, 10)
    while not _stop.is_set():
        try:
            run_due_monitors(max_per_tick=batch)
        except Exception:
            logger.exception("Monitoring scheduler tick failed")
        _stop.wait(interval)


def start_scheduler():
    global _thread
    if os.getenv("MONITOR_SCHEDULER_ENABLED", "true").lower() not in ("1", "true", "yes", "on"):
        return
    init_store()
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = Thread(target=_loop, name="terramind-monitor-scheduler", daemon=True)
    _thread.start()


def stop_scheduler():
    _stop.set()
    if _thread:
        _thread.join(timeout=3)
