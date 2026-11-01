"""Google Earth Engine authentication, catalog search, and processing facade."""
from __future__ import annotations
import base64
import json
import logging
import re
from typing import Optional

import ee

from .collections import DATASETS
from .errors import EarthEngineAuthenticationError, EarthEngineError, EarthEngineProcessingError, EarthEngineQuotaError
from .processing import prepare_ee_comparison, prepare_ee_image, valid_pixel_metrics
from .settings import EarthEngineSettings, get_ee_settings

logger = logging.getLogger(__name__)


def _sanitized_error_message(exc: Exception, settings: EarthEngineSettings) -> str:
    """Return useful provider diagnostics after removing credential material."""
    message = str(exc)
    sensitive_values = [
        settings.private_key_json,
        settings.private_key_b64,
        settings.service_account,
        settings.private_key_file,
    ]
    if settings.private_key_json:
        try:
            key_info = json.loads(settings.private_key_json)
            sensitive_values.extend((key_info.get("client_email", ""), key_info.get("private_key", "")))
        except (TypeError, ValueError):
            pass
    for value in sorted((value for value in sensitive_values if value), key=len, reverse=True):
        message = message.replace(value, "[REDACTED]")

    message = re.sub(
        r"-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----",
        "[REDACTED PRIVATE KEY]",
        message,
        flags=re.IGNORECASE | re.DOTALL,
    )
    message = re.sub(r"(?i)(bearer\s+)[A-Za-z0-9._~+/-]+=*", r"\1[REDACTED]", message)
    message = re.sub(r"\bAIza[0-9A-Za-z_-]{20,}\b", "[REDACTED API KEY]", message)
    message = re.sub(
        r'(?i)(["\']?(?:private_key|client_secret|access_token|refresh_token|id_token|api_key)["\']?\s*[:=]\s*)'
        r'("(?:\\.|[^"\\])*"|\'[^\']*\'|[^\s,)}]+)',
        r"\1[REDACTED]",
        message,
    )
    return message[:500] if message else "[no provider error message]"


class EarthEngineClient:
    def __init__(self, settings: Optional[EarthEngineSettings] = None):
        self.settings = settings or get_ee_settings()
        self._initialized = False

    def configured(self):
        mode = self.settings.auth_mode.lower()
        if not self.settings.project:
            return False
        if mode == "service_account":
            if self.settings.private_key_file:
                return bool(self.settings.service_account)
            return bool(self.settings.private_key_json or self.settings.private_key_b64)
        return mode == "ambient"

    def _service_account_json(self) -> str:
        if self.settings.private_key_json:
            return self.settings.private_key_json
        if self.settings.private_key_b64:
            try:
                return base64.b64decode(self.settings.private_key_b64).decode("utf-8")
            except Exception as exc:
                raise EarthEngineAuthenticationError("GEE_PRIVATE_KEY_B64 must be base64-encoded service-account JSON") from exc
        return ""

    def initialize(self):
        if self._initialized:
            return
        if not self.configured():
            raise EarthEngineAuthenticationError("Earth Engine project or server credentials are not configured")
        try:
            if self.settings.auth_mode.lower() == "service_account":
                if self.settings.private_key_file:
                    credentials = ee.ServiceAccountCredentials(self.settings.service_account, key_file=self.settings.private_key_file)
                else:
                    # The standard Google service-account JSON contains its identity.
                    # Earth Engine's credential class handles the OAuth JWT exchange
                    # and token refresh; credentials stay inside this backend process.
                    key_json = self._service_account_json()
                    key_info = json.loads(key_json)
                    account_email = self.settings.service_account or key_info.get("client_email", "")
                    if not account_email or not key_info.get("private_key"):
                        raise ValueError("Service-account JSON is missing required fields")
                    credentials = ee.ServiceAccountCredentials(account_email, key_data=key_json)
                ee.Initialize(credentials, project=self.settings.project)
            else:
                ee.Initialize(project=self.settings.project)
            self._initialized = True
        except EarthEngineError:
            raise
        except Exception as exc:
            logger.error(
                "Earth Engine initialization failed (%s): %s",
                type(exc).__name__,
                _sanitized_error_message(exc, self.settings),
            )
            raise EarthEngineAuthenticationError("Earth Engine initialization failed; verify server credentials and project access") from exc

    def status(self):
        if not self.configured():
            return {"configured": False, "authenticated": False, "project": self.settings.project or None, "auth_mode": self.settings.auth_mode, "message": "Earth Engine project or credentials are not configured"}
        try:
            self.initialize()
            ee.data.getAlgorithms()
            return {"configured": True, "authenticated": True, "project": self.settings.project, "auth_mode": self.settings.auth_mode, "message": "Earth Engine initialized"}
        except EarthEngineError as exc:
            return {"configured": True, "authenticated": False, "project": self.settings.project, "auth_mode": self.settings.auth_mode, "message": str(exc)}
        except Exception as exc:
            logger.error(
                "Earth Engine status check failed (%s): %s",
                type(exc).__name__,
                _sanitized_error_message(exc, self.settings),
            )
            return {"configured": True, "authenticated": False, "project": self.settings.project, "auth_mode": self.settings.auth_mode, "message": "Earth Engine credentials could not access the API"}

    @staticmethod
    def _raise_processing_error(exc):
        message = str(exc).lower()
        if any(term in message for term in ("quota", "rate limit", "too many requests", "429")):
            raise EarthEngineQuotaError("Earth Engine quota or rate limit reached") from exc
        if any(term in message for term in ("credential", "permission", "unauthorized", "authentication")):
            raise EarthEngineAuthenticationError("Earth Engine authentication or access failed") from exc
        raise EarthEngineProcessingError("Earth Engine processing request failed") from exc

    def search(self, request, geometry):
        self.initialize()
        dataset = DATASETS[request.dataset]
        try:
            collections = [ee.ImageCollection(cid).filterBounds(geometry).filterDate(request.start_date.isoformat(), request.end_date.isoformat()) for cid in dataset.collection_ids]
            collection = collections[0]
            for other in collections[1:]:
                collection = collection.merge(other)
            collection = collection.filter(ee.Filter.lte(dataset.cloud_property, request.max_cloud_cover))
            features = collection.map(lambda image: ee.Feature(None, {
                "image_id": image.id(),
                "date": image.date().format("YYYY-MM-dd"),
                "cloud_cover": image.get(dataset.cloud_property),
            }))
            raw = features.getInfo()
        except Exception as exc:
            self._raise_processing_error(exc)
        result = []
        for feature in raw.get("features", []):
            props = feature.get("properties", {})
            image_id = props.get("image_id")
            if not image_id:
                continue
            result.append({
                "date": props.get("date"), "dataset": request.dataset,
                "dataset_id": next((cid for cid in dataset.collection_ids if image_id.startswith(cid + "/")), dataset.collection_ids[0]),
                "image_id": image_id, "image_reference": image_id,
                "cloud_cover": props.get("cloud_cover"), "cloud_cover_property": dataset.cloud_property,
                "quality": {"cloud_cover_percent_scene": props.get("cloud_cover"), "metadata_source": "Earth Engine catalog"},
            })
        return result

    def prepare_observation(self, image_id, dataset, aoi, *, target_scale_m=None, target_crs=None):
        self.initialize()
        try:
            image, metadata = prepare_ee_image(image_id, dataset, aoi, target_scale_m=target_scale_m, target_crs=target_crs)
            scale = target_scale_m or DATASETS[dataset].resolution_m
            quality = valid_pixel_metrics(image, aoi, scale_m=scale, crs=target_crs)
            source = ee.Image(image_id)
            resolved = ee.Dictionary({
                "observation_date": source.date().format("YYYY-MM-dd"),
                "scene_cloud_cover_percent": source.get(DATASETS[dataset].cloud_property),
                "crs": image.select("blue").projection().crs(),
            }).getInfo()
        except Exception as exc:
            self._raise_processing_error(exc)
        metadata.update(resolved)
        metadata.update(quality)
        warnings = []
        if quality["valid_pixel_coverage_percent"] < 50:
            warnings.append("Less than 50% of AOI pixels are valid after dataset QA and nodata masking.")
        if quality["processing_status"] == "no_valid_pixels":
            warnings.append("No valid pixels remain inside the requested area.")
        cloud = metadata["scene_cloud_cover_percent"]
        if cloud is not None and cloud > 50:
            warnings.append("Scene-level cloud cover exceeds 50%; inspect AOI valid-pixel coverage before analysis.")
        metadata["warnings"] = warnings
        return {"image": image, "image_reference": image_id, "metadata": metadata, "processing_status": quality["processing_status"]}

    def prepare_comparison(self, first_id, first_dataset, second_id, second_dataset, aoi, *, target_crs, target_scale_m=30, minimum_joint_coverage_percent=20.0):
        self.initialize()
        try:
            return prepare_ee_comparison(first_id, first_dataset, second_id, second_dataset, aoi, target_crs=target_crs, target_scale_m=target_scale_m, minimum_joint_coverage_percent=minimum_joint_coverage_percent)
        except (EarthEngineQuotaError, EarthEngineAuthenticationError, EarthEngineProcessingError):
            raise
        except ValueError:
            raise
        except Exception as exc:
            self._raise_processing_error(exc)


earth_engine_client = EarthEngineClient()
