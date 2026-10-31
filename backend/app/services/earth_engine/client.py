"""Google Earth Engine authentication, catalog search, and processing facade."""
from __future__ import annotations
import logging
from typing import Optional

import ee

from .collections import DATASETS
from .errors import EarthEngineAuthenticationError, EarthEngineError, EarthEngineProcessingError, EarthEngineQuotaError
from .processing import prepare_ee_comparison, prepare_ee_image, valid_pixel_metrics
from .settings import EarthEngineSettings, get_ee_settings

logger = logging.getLogger(__name__)


class EarthEngineClient:
    def __init__(self, settings: Optional[EarthEngineSettings] = None):
        self.settings = settings or get_ee_settings()
        self._initialized = False

    def configured(self):
        mode = self.settings.auth_mode.lower()
        if not self.settings.project:
            return False
        if mode == "service_account":
            return bool(self.settings.service_account and (self.settings.private_key_json or self.settings.private_key_file))
        return mode == "ambient"

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
                    credentials = ee.ServiceAccountCredentials(self.settings.service_account, key_data=self.settings.private_key_json)
                ee.Initialize(credentials, project=self.settings.project)
            else:
                ee.Initialize(project=self.settings.project)
            self._initialized = True
        except Exception as exc:
            logger.error("Earth Engine initialization failed; check server credentials and project access")
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
        except Exception:
            logger.exception("Earth Engine status failed")
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
