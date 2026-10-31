"""Lazy Earth Engine preprocessing and Module 5 layer preparation."""
from __future__ import annotations
import ee
from typing import Optional
from .collections import CANONICAL_BANDS, DATASETS


def prepare_ee_image(image_id: str, dataset: str, aoi, *, target_scale_m: Optional[int] = None, target_crs: Optional[str] = None):
    config = DATASETS[dataset]
    source = ee.Image(image_id)
    reflectance = config.preprocess(source).select(list(config.source_bands), list(CANONICAL_BANDS))
    valid = reflectance.mask().reduce(ee.Reducer.min()).rename("valid_pixel").unmask(0).clip(aoi)
    scale = target_scale_m or config.resolution_m
    projection = target_crs or reflectance.select("blue").projection()
    # Reflectance is continuous; the categorical validity band uses nearest neighbor.
    reflectance = reflectance.clip(aoi).resample("bilinear").reproject(crs=projection, scale=scale)
    valid = valid.reproject(crs=projection, scale=scale)
    image = reflectance.addBands(valid)
    metadata = {
        "image_reference": image_id,
        "dataset": dataset,
        "dataset_id": image_id.rsplit("/", 1)[0],
        "observation_date": source.date().format("YYYY-MM-dd"),
        "scene_cloud_cover_percent": source.get(config.cloud_property),
        "spatial_resolution_m": scale,
        "bands": list(CANONICAL_BANDS),
        "crs": image.select("blue").projection().crs(),
        "processing_status": "prepared",
        "image": image,
        "nodata_policy": "Invalid reflectance remains masked; valid_pixel is an explicit QA flag, not an environmental value.",
    }
    return image, metadata


def valid_pixel_metrics(image, aoi, *, scale_m: int, crs: Optional[str] = None):
    image = ee.Image(image)
    valid = image.select("valid_pixel").eq(1)
    projection = image.select("valid_pixel").projection()
    args = {"geometry": aoi, "scale": scale_m, "maxPixels": 10_000_000}
    if crs:
        args["crs"] = crs
    totals = ee.Image.cat([
        valid.rename("valid_count"),
        ee.Image.constant(1).clip(aoi).rename("total_count").reproject(crs=projection, scale=scale_m),
    ]).reduceRegion(reducer=ee.Reducer.sum(), **args).getInfo()
    valid_count = int(totals.get("valid_count") or 0)
    total_count = int(totals.get("total_count") or 0)
    return {
        "valid_pixel_count": valid_count,
        "total_pixel_count": total_count,
        "valid_pixel_coverage_percent": 100 * valid_count / total_count if total_count else 0.0,
        "processing_status": "ready" if valid_count else "no_valid_pixels",
    }


def prepare_ee_comparison(first_id, first_dataset, second_id, second_dataset, aoi, *, target_crs, target_scale_m=30, minimum_joint_coverage_percent=20.0):
    first, first_meta = prepare_ee_image(first_id, first_dataset, aoi, target_crs=target_crs, target_scale_m=target_scale_m)
    second, second_meta = prepare_ee_image(second_id, second_dataset, aoi, target_crs=target_crs, target_scale_m=target_scale_m)
    bands = sorted(set(first_meta["bands"]) & set(second_meta["bands"]))
    joint = first.select("valid_pixel").eq(1).And(second.select("valid_pixel").eq(1)).rename("valid_pixel").unmask(0)
    coverage = valid_pixel_metrics(joint, aoi, scale_m=target_scale_m, crs=target_crs)["valid_pixel_coverage_percent"]
    if not bands:
        raise ValueError("Observations have no compatible reflectance bands")
    if coverage < minimum_joint_coverage_percent:
        raise ValueError(f"Only {coverage:.1f}% of AOI pixels are valid in both observations; minimum is {minimum_joint_coverage_percent:.1f}%")
    mask = joint.eq(1)
    warnings = []
    if coverage < 50:
        warnings.append("Less than 50% of AOI pixels are jointly valid across both observations.")
    for meta in (first_meta, second_meta):
        if target_scale_m < DATASETS[meta["dataset"]].resolution_m:
            warnings.append(f"Upsampling {meta['dataset']} to {target_scale_m} m does not create new spatial detail.")
    return {
        "first_image": first.select(bands).updateMask(mask),
        "second_image": second.select(bands).updateMask(mask),
        "joint_valid_mask": mask,
        "bands": bands,
        "target_crs": target_crs,
        "target_resolution_m": target_scale_m,
        "joint_valid_pixel_coverage_percent": coverage,
        "first_metadata": first_meta,
        "second_metadata": second_meta,
        "warnings": warnings,
        "processing_status": "ready",
        "nodata_policy": "Only jointly valid pixels are present in either comparison layer; invalid pixels remain masked.",
    }
