"""Celery worker + beat schedule.

Run:  celery -A app.worker worker --beat --loglevel=info

Tasks are thin sync wrappers around the async job functions. Each run gets its own
event loop, engine (NullPool) and Redis client, because asyncio resources can't be
shared across the separate loops that ``asyncio.run`` creates.
"""

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from celery import Celery
from celery.signals import setup_logging
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.config import settings
from app.logconfig import configure_logging
from app.notifications import Notification
from app.realtime import Publisher
from app.services import jobs

celery = Celery("queueup", broker=settings.redis_url)
celery.conf.update(
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    timezone="UTC",
    beat_schedule={
        "sweep-expired-holds": {"task": "app.worker.sweep_expired_holds", "schedule": 15.0},
        "auto-close-events": {"task": "app.worker.auto_close_events", "schedule": 120.0},
        "send-reminders": {"task": "app.worker.send_reminders", "schedule": 300.0},
        "reconcile-inventory": {"task": "app.worker.reconcile_inventory", "schedule": 3600.0},
    },
)


@setup_logging.connect
def _logging(**_: Any) -> None:
    configure_logging()


def _run(job: Callable[[AsyncSession], Awaitable[Any]]) -> Any:
    async def main() -> Any:
        engine = create_async_engine(settings.database_url, poolclass=NullPool)
        publisher = Publisher(settings.redis_url)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False)() as session:
                result = await job(session)
            if isinstance(result, list) and all(isinstance(n, Notification) for n in result):
                await publisher.publish(result)
                return len(result)
            return result
        finally:
            await publisher.close()
            await engine.dispose()

    return asyncio.run(main())


@celery.task(name="app.worker.sweep_expired_holds")
def sweep_expired_holds() -> Any:
    return _run(jobs.sweep_expired_holds)


@celery.task(name="app.worker.auto_close_events")
def auto_close_events() -> Any:
    return _run(jobs.auto_close_events)


@celery.task(name="app.worker.send_reminders")
def send_reminders() -> Any:
    return _run(jobs.send_reminders)


@celery.task(name="app.worker.reconcile_inventory")
def reconcile_inventory() -> Any:
    return _run(jobs.reconcile_inventory)
