class EarthEngineError(Exception):
    status_code = 502
    code = "earth_engine_error"


class EarthEngineAuthenticationError(EarthEngineError):
    status_code = 503
    code = "earth_engine_authentication_error"


class EarthEngineQuotaError(EarthEngineError):
    status_code = 429
    code = "earth_engine_quota_exceeded"


class EarthEngineProcessingError(EarthEngineError):
    status_code = 502
    code = "earth_engine_processing_failed"
