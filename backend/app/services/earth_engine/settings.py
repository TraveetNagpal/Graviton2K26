from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class EarthEngineSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    project: str = Field(default="", validation_alias="GEE_PROJECT")
    service_account: str = Field(default="", validation_alias="GEE_SERVICE_ACCOUNT")
    private_key_json: str = Field(default="", validation_alias="GEE_PRIVATE_KEY_JSON")
    private_key_file: str = Field(default="", validation_alias="GEE_PRIVATE_KEY_FILE")
    auth_mode: str = Field(default="service_account", validation_alias="GEE_AUTH_MODE")
    max_search_days: int = Field(default=3650, ge=1, validation_alias="MAX_SEARCH_DAYS")
    max_aoi_area_sq_km: float = Field(default=1_000_000, gt=0, validation_alias="MAX_AOI_AREA_SQ_KM")


@lru_cache
def get_ee_settings() -> EarthEngineSettings:
    return EarthEngineSettings()
