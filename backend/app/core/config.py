"""Environment based application configuration."""
import os
from functools import lru_cache

from pydantic import AliasChoices, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url

_LOCAL_DATABASE_URL = "postgresql+psycopg://terramind:terramind@localhost:5432/terramind"


class Settings(BaseSettings):
    # Read the backend .env first and fall back to the repository-root .env that
    # local development uses for shared secrets (later files win).
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")
    # Neon's Vercel integration exposes DATABASE_URL plus POSTGRES_URL variants.
    database_url: str = Field(
        default=_LOCAL_DATABASE_URL,
        validation_alias=AliasChoices("DATABASE_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING", "NEON_DATABASE_URL"),
    )
    cors_origins: str = Field(default="*", validation_alias="CORS_ORIGINS")
    environment: str = Field(default="development", validation_alias="ENVIRONMENT")
    max_request_bytes: int = Field(default=1_000_000, ge=1024, validation_alias="MAX_REQUEST_BYTES")
    report_storage_dir: str = Field(default="./data/reports", validation_alias="REPORT_STORAGE_DIR")
    persist_analysis_jobs: bool = Field(default=False, validation_alias="PERSIST_ANALYSIS_JOBS")
    monitoring_scheduler_enabled: bool = Field(default=False, validation_alias="MONITORING_SCHEDULER_ENABLED")
    inline_analysis: bool = Field(default=False, validation_alias="INLINE_ANALYSIS")
    auto_migrate: bool = Field(default=False, validation_alias=AliasChoices("AUTO_MIGRATE", "MIGRATE_ON_STARTUP"))

    @field_validator("database_url")
    @classmethod
    def normalize_database_url(cls, value: str) -> str:
        """Accept plain postgres URLs from managed providers and add TLS for remote hosts."""
        url = make_url(value.strip() or _LOCAL_DATABASE_URL)
        if url.drivername in ("postgres", "postgresql"):
            url = url.set(drivername="postgresql+psycopg")
        if url.host not in (None, "localhost", "127.0.0.1", "::1") and "sslmode" not in url.query:
            url = url.update_query_dict({"sslmode": "require"})
        return url.render_as_string(hide_password=False)


@lru_cache
def get_settings() -> Settings:
    return Settings()


class AISettings(BaseSettings):
    """Gemini configuration for every AI interpretation in the backend.

    Gemini is reached through Google's OpenAI-compatible API, so the
    investigator keeps one chat-completions code path. The legacy LLM_*
    variables remain accepted as aliases for existing deployments.
    """

    # Read the backend .env first and fall back to the repository-root .env that
    # local development uses for shared secrets (later files win).
    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")
    api_key: str = Field(default="", validation_alias=AliasChoices("GEMINI_API_KEY", "LLM_API_KEY"))
    model: str = Field(default="gemini-3.5-flash", validation_alias=AliasChoices("GEMINI_MODEL", "LLM_MODEL"))
    base_url: str = Field(
        default="https://generativelanguage.googleapis.com/v1beta/openai",
        validation_alias=AliasChoices("GEMINI_BASE_URL", "LLM_BASE_URL"),
    )
    timeout_seconds: float = Field(default=30, gt=0, le=120, validation_alias=AliasChoices("GEMINI_TIMEOUT_SECONDS", "LLM_TIMEOUT_SECONDS"))


@lru_cache
def get_ai_settings() -> AISettings:
    return AISettings()


def run_analysis_inline() -> bool:
    """Serverless platforms freeze the instance after the response, so completed
    background work cannot be relied on. Vercel sets VERCEL=1."""
    return get_settings().inline_analysis or os.environ.get("VERCEL") == "1"


def should_auto_migrate() -> bool:
    """Apply Alembic migrations during startup, including on Vercel by default."""
    return get_settings().auto_migrate or os.environ.get("VERCEL") == "1"
