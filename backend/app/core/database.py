"""SQLAlchemy database setup. Connections are opened lazily so local unit tests
and health probes can start even when PostgreSQL is temporarily unavailable."""
import os
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import NullPool

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


def _is_serverless() -> bool:
    return os.getenv("VERCEL") == "1"


@lru_cache
def get_engine():
    settings = get_settings()
    url = settings.database_url
    connect_args: dict = {"connect_timeout": 10}
    engine_kwargs: dict = {}
    if _is_serverless():
        # Function instances are short-lived; Neon's pooler owns connection reuse.
        engine_kwargs["poolclass"] = NullPool
    else:
        engine_kwargs.update(pool_pre_ping=True, pool_recycle=300, pool_size=5, max_overflow=5)
    if "-pooler" in url:
        # Transaction-mode poolers cannot reuse prepared statements.
        connect_args["prepare_threshold"] = None
    return create_engine(url, connect_args=connect_args, **engine_kwargs)


@lru_cache
def get_session_factory():
    return sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False)


def get_db():
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()
