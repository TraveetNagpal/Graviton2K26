"""Earth Engine numerical change-detection engine.

All scientific raster math and region area reductions are performed by Earth Engine.
Only summary numbers and compact visualization tile references leave this service.
"""
from datetime import datetime, timezone
from typing import Any

import ee

from app.services.earth_engine.client import earth_engine_client
from app.services.earth_engine.errors import EarthEngineError
from app.services.earth_engine.processing import prepare_ee_comparison


PALETTES = {
    "vegetation": ["#b2182b", "#f7f7f7", "#1a9850"],
    "water": ["#b2182b", "#f7f7f7", "#2166ac"],
    "urban": ["#1a9850", "#f7f7f7", "#b2182b"],
}
VISUALIZATION = {
    "vegetation": {"min": -0.5, "max": 0.5, "palette": PALETTES["vegetation"]},
    "water": {"min": -1, "max": 1, "palette": PALETTES["water"]},
    "urban": {"min": -1, "max": 1, "palette": PALETTES["urban"]},
}


def _area_m2(image, region, *, scale, crs):
    result = ee.Image.pixelArea().rename("area_m2").updateMask(image).reduceRegion(
        reducer=ee.Reducer.sum(), geometry=region, scale=scale, crs=crs, maxPixels=10_000_000,
    ).getInfo()
    return float(result.get("area_m2") or 0.0)


def _mean(image, region, *, scale, crs):
    values = image.rename("value").reduceRegion(
        reducer=ee.Reducer.mean(), geometry=region, scale=scale, crs=crs, maxPixels=10_000_000,
    ).getInfo()
    return values.get("value")


def _source_metadata(image_id, dataset):
    image = ee.Image(image_id)
    from app.services.earth_engine.collections import DATASETS
    metadata = ee.Dictionary({
        "date": image.date().format("YYYY-MM-dd"),
        "cloud_cover_scene_percent": image.get(DATASETS[dataset].cloud_property),
        "dataset_id": image_id.rsplit("/", 1)[0],
        "image_id": image_id,
        "dataset": dataset,
    }).getInfo()
    return metadata


class ChangeDetectionEngine:
    def analyze(self, kind: str, request: dict[str, Any]) -> dict[str, Any]:
        try:
            return self._analyze(kind, request)
        except (ValueError, EarthEngineError):
            raise
        except Exception as exc:
            earth_engine_client._raise_processing_error(exc)

    def _analyze(self, kind: str, request: dict[str, Any]) -> dict[str, Any]:
        earth_engine_client.initialize()
        region = ee.Geometry(request["area_of_interest"])
        scale = request["target_scale_m"]
        crs = request["target_crs"]
        comparison = prepare_ee_comparison(
            request["earlier_image_id"], request["earlier_dataset"],
            request["later_image_id"], request["later_dataset"], region,
            target_crs=crs, target_scale_m=scale,
            minimum_joint_coverage_percent=request["minimum_valid_coverage_percent"],
        )
        earlier = comparison["first_image"]
        later = comparison["second_image"]
        valid = comparison["joint_valid_mask"]
        earlier_metadata = _source_metadata(request["earlier_image_id"], request["earlier_dataset"])
        later_metadata = _source_metadata(request["later_image_id"], request["later_dataset"])
        if earlier_metadata["date"] >= later_metadata["date"]:
            raise ValueError("Earlier and later image IDs must refer to chronologically ordered observations")
        epsilon = request["denominator_epsilon"]
        warnings = list(comparison["warnings"])
        coverage = comparison["joint_valid_pixel_coverage_percent"]
        if coverage < 50:
            warnings.append("Less than half of the selected area has valid pixels in both observations.")
        if scale > 30:
            warnings.append("The requested analysis grid is coarser than 30 m; small or narrow changes may be missed.")
        if scale > 100:
            warnings.append("The requested grid is very coarse for local land-cover change interpretation.")

        if kind == "vegetation":
            method = "NDVI=(NIR-Red)/(NIR+Red); difference=later-earlier"
            threshold = request["change_threshold"]
            earlier_index = _normalized_difference(earlier, "red", "nir", epsilon).rename("ndvi_earlier")
            later_index = _normalized_difference(later, "red", "nir", epsilon).rename("ndvi_later")
            change = later_index.subtract(earlier_index).rename("ndvi_difference").updateMask(valid)
            decrease = change.lte(-threshold)
            increase = change.gte(threshold)
            decrease_area = _area_m2(decrease, region, scale=scale, crs=crs)
            increase_area = _area_m2(increase, region, scale=scale, crs=crs)
            mean_earlier = _mean(earlier_index, region, scale=scale, crs=crs)
            mean_later = _mean(later_index, region, scale=scale, crs=crs)
            measurements = {
                "mean_ndvi_earlier": mean_earlier,
                "mean_ndvi_later": mean_later,
                "mean_ndvi_difference": _mean(change, region, scale=scale, crs=crs),
                "decrease_threshold": -threshold,
                "increase_threshold": threshold,
                "mapped_decrease_area_m2": decrease_area,
                "mapped_decrease_area_ha": decrease_area / 10_000,
                "mapped_increase_area_m2": increase_area,
                "mapped_increase_area_ha": increase_area / 10_000,
            }
            layer_images = {"change": change, "earlier_index": earlier_index, "later_index": later_index}
            warnings.append("A negative NDVI difference indicates a decrease in the index; it is not definitive proof of vegetation loss.")
        elif kind == "water":
            method = "McFeeters NDWI=(Green-NIR)/(Green+NIR); mapped water is NDWI greater than threshold"
            threshold = request["water_threshold"]
            earlier_index = _normalized_difference(earlier, "nir", "green", epsilon).rename("ndwi_earlier")
            later_index = _normalized_difference(later, "nir", "green", epsilon).rename("ndwi_later")
            class_valid = earlier_index.mask().And(later_index.mask()).And(valid)
            earlier_water = earlier_index.gt(threshold).updateMask(class_valid)
            later_water = later_index.gt(threshold).updateMask(class_valid)
            change = later_water.unmask(0).subtract(earlier_water.unmask(0)).rename("water_change").updateMask(class_valid)
            earlier_area = _area_m2(earlier_water, region, scale=scale, crs=crs)
            later_area = _area_m2(later_water, region, scale=scale, crs=crs)
            gain_area = _area_m2(change.eq(1), region, scale=scale, crs=crs)
            loss_area = _area_m2(change.eq(-1), region, scale=scale, crs=crs)
            measurements = {
                "water_threshold": threshold,
                "mapped_water_area_earlier_m2": earlier_area,
                "mapped_water_area_earlier_ha": earlier_area / 10_000,
                "mapped_water_area_later_m2": later_area,
                "mapped_water_area_later_ha": later_area / 10_000,
                "net_mapped_water_area_change_m2": later_area - earlier_area,
                "mapped_water_gain_area_m2": gain_area,
                "mapped_water_gain_area_ha": gain_area / 10_000,
                "mapped_water_loss_area_m2": loss_area,
                "mapped_water_loss_area_ha": loss_area / 10_000,
                "mean_ndwi_earlier": _mean(earlier_index, region, scale=scale, crs=crs),
                "mean_ndwi_later": _mean(later_index, region, scale=scale, crs=crs),
            }
            layer_images = {"change": change, "earlier_index": earlier_index, "later_index": later_index, "water_extent_later": later_water}
            warnings.append("NDWI threshold classification can confuse built surfaces, shadows, wet soil and turbid/shallow water with open water; mapped extent is threshold-dependent.")
        elif kind == "urban":
            method = "NDBI=(SWIR1-NIR)/(SWIR1+NIR); built-up proxy is NDBI greater than threshold"
            threshold = request["built_up_threshold"]
            earlier_index = _normalized_difference(earlier, "nir", "swir1", epsilon).rename("ndbi_earlier")
            later_index = _normalized_difference(later, "nir", "swir1", epsilon).rename("ndbi_later")
            class_valid = earlier_index.mask().And(later_index.mask()).And(valid)
            earlier_built = earlier_index.gt(threshold).updateMask(class_valid)
            later_built = later_index.gt(threshold).updateMask(class_valid)
            change = later_built.unmask(0).subtract(earlier_built.unmask(0)).rename("built_up_proxy_change").updateMask(class_valid)
            earlier_area = _area_m2(earlier_built, region, scale=scale, crs=crs)
            later_area = _area_m2(later_built, region, scale=scale, crs=crs)
            increase_area = _area_m2(change.eq(1), region, scale=scale, crs=crs)
            decrease_area = _area_m2(change.eq(-1), region, scale=scale, crs=crs)
            measurements = {
                "built_up_proxy_threshold": threshold,
                "mapped_built_up_proxy_area_earlier_m2": earlier_area,
                "mapped_built_up_proxy_area_earlier_ha": earlier_area / 10_000,
                "mapped_built_up_proxy_area_later_m2": later_area,
                "mapped_built_up_proxy_area_later_ha": later_area / 10_000,
                "net_mapped_built_up_proxy_change_m2": later_area - earlier_area,
                "net_mapped_built_up_proxy_change_ha": (later_area - earlier_area) / 10_000,
                "mapped_built_up_proxy_increase_area_m2": increase_area,
                "mapped_built_up_proxy_increase_area_ha": increase_area / 10_000,
                "mapped_built_up_proxy_decrease_area_m2": decrease_area,
                "mapped_built_up_proxy_decrease_area_ha": decrease_area / 10_000,
                "mean_ndbi_earlier": _mean(earlier_index, region, scale=scale, crs=crs),
                "mean_ndbi_later": _mean(later_index, region, scale=scale, crs=crs),
            }
            layer_images = {"change": change, "earlier_index": earlier_index, "later_index": later_index, "built_up_proxy_later": later_built}
            warnings.append("NDBI thresholding is a coarse built-up land-surface proxy, not a validated land-cover classification or individual-building detector; bright soil, bare ground and dry surfaces can be false positives.")
        else:
            raise ValueError(f"Unsupported analysis type: {kind}")

        effective_valid = change.mask().reduce(ee.Reducer.min()).unmask(0).rename("valid_pixel")
        index_coverage = valid_pixel_metrics(effective_valid, region, scale_m=scale, crs=crs)["valid_pixel_coverage_percent"]
        if index_coverage < request["minimum_valid_coverage_percent"]:
            raise ValueError(f"Only {index_coverage:.1f}% of AOI pixels have valid index values in both observations; minimum is {request['minimum_valid_coverage_percent']:.1f}%")
        if index_coverage < 50:
            warnings.append("Fewer than half of AOI pixels remain usable after index denominator checks and shared QA masks.")

        for label, metadata in (("Earlier", earlier_metadata), ("Later", later_metadata)):
            cloud = metadata.get("cloud_cover_scene_percent")
            if cloud is not None and cloud > 50:
                warnings.append(f"{label} scene-level cloud cover is {cloud}%; AOI validity is separately measured.")

        result = {
            "analysis_id": request["analysis_id"],
            "analysis_type": kind,
            "status": "completed",
            "change_layer": {"name": "change", "layers_endpoint": f"/api/analysis/{request['analysis_id']}/layers"},
            "region": request["area_of_interest"],
            "observation_dates": {"earlier": earlier_metadata["date"], "later": later_metadata["date"]},
            "datasets": {"earlier": earlier_metadata, "later": later_metadata},
            "analysis_method": method,
            "parameters": {key: request[key] for key in ("target_scale_m", "target_crs", "denominator_epsilon") if key in request},
            "valid_pixel_coverage_percent": index_coverage,
            "measurements": measurements,
            "quality_warnings": warnings,
            "uncertainty": {
                "description": "Thresholded index changes are deterministic measurements. They are not calibrated probabilities; classification uncertainty is not modeled.",
                "threshold_sensitivity_evaluated": False,
                "joint_valid_pixel_coverage_percent": coverage,
                "index_valid_pixel_coverage_percent": index_coverage,
            },
            "created_at": datetime.now(timezone.utc).isoformat(),
            "_layer_images": layer_images,
        }
        return result


def _normalized_difference(image, first_band: str, second_band: str, epsilon: float):
    first = image.select(first_band)
    second = image.select(second_band)
    denominator = second.add(first)
    valid = denominator.abs().gt(epsilon)
    return second.subtract(first).divide(denominator).updateMask(valid)


change_detection_engine = ChangeDetectionEngine()
