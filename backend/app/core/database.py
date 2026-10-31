"""SQLAlchemy database setup. Connections are opened lazily so local unit tests
and health probes can start even when PostgreSQL is temporarily unavailable."""
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import get_settings


class Base(DeclarativeBase):
    pass


@lru_cache
def get_engine():
    settings = get_settings()
    return create_engine(settings.database_url, pool_pre_ping=True, pool_recycle=300)


@lru_cache
def get_session_factory():
    return sessionmaker(bind=get_engine(), autoflush=False, expire_on_commit=False)


def get_db():
    session = get_session_factory()()
    try:
        yield session
    finally:
        session.close()
