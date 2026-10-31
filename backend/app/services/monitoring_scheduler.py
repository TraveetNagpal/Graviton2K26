"""Single-process UTC cron trigger for saved monitoring analyses."""
import logging
from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select

from app.core.config import get_settings
from app.core.database import get_session_factory
from app.models.schema import MonitoringConfiguration
from app.services.analysis.jobs import run_job, submit

logger = logging.getLogger(__name__)
scheduler = BackgroundScheduler(timezone="UTC")

def _run_configuration(configuration_id: int):
    try:
        with get_session_factory()() as db:
            config = db.scalar(select(MonitoringConfiguration).where(MonitoringConfiguration.id == configuration_id, MonitoringConfiguration.active.is_(True)))
            if config is None: return
            analysis_id = submit(config.analysis_type, config.parameters, owner_id=config.owner_id)
        run_job(analysis_id)
    except Exception:
        logger.exception("Scheduled monitoring execution failed for configuration %s", configuration_id)

def schedule_configuration(configuration_id: int, expression: str):
    if not get_settings().monitoring_scheduler_enabled: return
    try:
        trigger = CronTrigger.from_crontab(expression, timezone="UTC")
        scheduler.add_job(_run_configuration, trigger, args=[configuration_id], id=f"monitor-{configuration_id}", replace_existing=True, max_instances=1, coalesce=True)
    except Exception as exc:
        raise ValueError("Schedule must use a valid five-field UTC cron expression") from exc

def start_scheduler():
    if not get_settings().monitoring_scheduler_enabled or scheduler.running: return
    scheduler.start()
    with get_session_factory()() as db:
        configs = db.scalars(select(MonitoringConfiguration).where(MonitoringConfiguration.active.is_(True))).all()
        for config in configs:
            try: schedule_configuration(config.id, config.schedule)
            except ValueError: logger.error("Skipping invalid monitoring schedule %s", config.id)

def stop_scheduler():
    if scheduler.running: scheduler.shutdown(wait=False)
