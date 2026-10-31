"""Environment based application configuration."""
from functools import lru_cache
from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = Field(default="postgresql+psycopg://terramind:terramind@localhost:5432/terramind", validation_alias="DATABASE_URL")
    cors_origins: str = Field(default="http://localhost:5173,http://localhost:3000", validation_alias="CORS_ORIGINS")
    environment: str = Field(default="development", validation_alias="ENVIRONMENT")
    auth_secret: str = Field(default="", validation_alias="AUTH_SECRET")
    auth_token_minutes: int = Field(default=60, ge=5, le=1440, validation_alias="AUTH_TOKEN_MINUTES")
    max_request_bytes: int = Field(default=1_000_000, ge=1024, validation_alias="MAX_REQUEST_BYTES")
    report_storage_dir: str = Field(default="./data/reports", validation_alias="REPORT_STORAGE_DIR")
    persist_analysis_jobs: bool = Field(default=False, validation_alias="PERSIST_ANALYSIS_JOBS")
    monitoring_scheduler_enabled: bool = Field(default=False, validation_alias="MONITORING_SCHEDULER_ENABLED")

    @model_validator(mode="after")
    def strong_auth_secret(self):
        if self.auth_secret and len(self.auth_secret) < 32:
            raise ValueError("AUTH_SECRET must contain at least 32 characters")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


class AISettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    api_key: str = Field(default="", validation_alias="LLM_API_KEY")
    model: str = Field(default="", validation_alias="LLM_MODEL")
    base_url: str = Field(default="https://api.openai.com/v1", validation_alias="LLM_BASE_URL")
    timeout_seconds: float = Field(default=20, gt=0, le=120, validation_alias="LLM_TIMEOUT_SECONDS")


@lru_cache
def get_ai_settings() -> AISettings:
    return AISettings()
