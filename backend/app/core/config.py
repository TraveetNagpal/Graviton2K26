"""Environment based configuration for optional AI explanations."""
from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class AISettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    api_key: str = Field(default="", validation_alias="LLM_API_KEY")
    model: str = Field(default="", validation_alias="LLM_MODEL")
    base_url: str = Field(default="https://api.openai.com/v1", validation_alias="LLM_BASE_URL")
    timeout_seconds: float = Field(default=20, gt=0, le=120, validation_alias="LLM_TIMEOUT_SECONDS")


@lru_cache
def get_ai_settings() -> AISettings:
    return AISettings()
