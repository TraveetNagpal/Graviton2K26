"""Dataset-aware raster preparation and comparison checks.

Masked pixels stay masked throughout; this module never substitutes zero for nodata.
Arrays are in band-first order (bands, rows, columns).
"""
from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Optional, Union

import numpy as np


class ComparisonNotSuitable(ValueError):
    """Raised when two scenes cannot support a meaningful pixel comparison."""


@dataclass
class PreparedRaster:
    bands: dict[str, np.ndarray]
    valid_mask: np.ndarray
    metadata: dict[str, Any]


def _qa_mask(dataset: str, qa: Optional[np.ndarray], shape: tuple[int, int]) -> np.ndarray:
    if qa is None:
        return np.ones(shape, dtype=bool)
    qa = np.asarray(qa)
    if qa.shape != shape:
        raise ValueError("QA layer shape must match image bands")
    if dataset == "sentinel-2":
        # SCL 3=cloud shadow, 8/9=cloud, 10=cirrus, 11=snow/ice.
        # Also exclude no-data (0) and saturated/defective (1).
        return ~np.isin(qa, [0, 1, 3, 8, 9, 10, 11])
    if dataset.startswith("landsat"):
        # Collection 2 QA_PIXEL: dilated cloud, cirrus, cloud, shadow, snow.
        invalid_bits = (1 << 0) | (1 << 1) | (1 << 2) | (1 << 3) | (1 << 4) | (1 << 5)
        return (qa.astype(np.uint16) & invalid_bits) == 0
    raise ValueError(f"Unsupported dataset: {dataset}")


def prepare_local_raster(
    dataset: str,
    data: np.ndarray,
    band_names: list[str],
    *,
    qa: Optional[np.ndarray] = None,
    nodata: Optional[Union[float, int]] = None,
    cloud_cover: Optional[float] = None,
    observation_date: Optional[str] = None,
    dataset_id: Optional[str] = None,
    resolution_m: Optional[float] = None,
    crs: Optional[str] = None,
    transform: Any = None,
) -> PreparedRaster:
    """Scale SR, apply dataset QA, and report valid coverage without filling nodata.

    For Sentinel-2, `qa` contains SCL. For Landsat C2 L2, it contains QA_PIXEL.
    QA masking is applied only when the QA layer is supplied.
    """
    array = np.asarray(data)
    if array.ndim != 3 or array.shape[0] != len(band_names):
        raise ValueError("data must have shape (bands, rows, columns) matching band_names")
    if dataset not in ("sentinel-2", "landsat", "landsat-8", "landsat-9"):
        raise ValueError(f"Unsupported dataset: {dataset}")
    raw = array.astype(np.float32, copy=False)
    valid = np.all(np.isfinite(raw), axis=0)
    if nodata is not None:
        valid &= np.all(raw != nodata, axis=0)
    valid &= _qa_mask(dataset, qa, raw.shape[1:])
    scale, offset = (0.0001, 0.0) if dataset == "sentinel-2" else (0.0000275, -0.2)
    scaled = raw * scale + offset
    bands = {}
    for index, name in enumerate(band_names):
        band = scaled[index].copy()
        band[~valid] = np.nan
        bands[name] = band
    total = int(valid.size)
    valid_count = int(valid.sum())
    valid_pct = 100.0 * valid_count / total if total else 0.0
    warnings = []
    if cloud_cover is not None and cloud_cover > 50:
        warnings.append("Scene-level cloud cover exceeds 50%; AOI valid-pixel coverage is reported separately.")
    if valid_pct < 50:
        warnings.append("Less than 50% of AOI pixels are valid after nodata and QA masking.")
    if qa is None:
        warnings.append("No dataset QA layer was supplied; cloud and cloud-shadow masking could not be applied.")
    return PreparedRaster(bands, valid, {
        "observation_date": observation_date,
        "cloud_cover_percent_scene": cloud_cover,
        "valid_pixel_count": valid_count,
        "total_pixel_count": total,
        "valid_pixel_coverage_percent": valid_pct,
        "spatial_resolution_m": resolution_m,
        "crs": crs,
        "transform": transform,
        "dataset": dataset,
        "dataset_id": dataset_id,
        "processing_status": "ready" if valid_count else "no_valid_pixels",
        "warnings": warnings,
        "nodata_policy": "Invalid pixels remain masked/NaN; they are not interpreted as zero.",
    })


def prepare_comparison(first: PreparedRaster, second: PreparedRaster, *, max_resolution_difference_ratio: float = 2.0) -> dict[str, Any]:
    """Validate common bands, grids, CRS and overlapping valid pixels."""
    a, b = first.metadata, second.metadata
    if not a.get("crs") or a.get("crs") != b.get("crs"):
        raise ComparisonNotSuitable("Observations have missing or incompatible coordinate reference systems; reproject both to one target grid first.")
    common_bands = sorted(set(first.bands) & set(second.bands))
    if not common_bands:
        raise ComparisonNotSuitable("Observations do not contain compatible bands.")
    ra, rb = a.get("spatial_resolution_m"), b.get("spatial_resolution_m")
    if not ra or not rb or min(ra, rb) <= 0:
        raise ComparisonNotSuitable("Spatial resolution metadata is missing or invalid.")
    ratio = max(ra, rb) / min(ra, rb)
    if ratio > max_resolution_difference_ratio:
        raise ComparisonNotSuitable(f"Resolution differs by {ratio:.1f}x; prepare both scenes on a common coarser grid first.")
    if first.valid_mask.shape != second.valid_mask.shape:
        raise ComparisonNotSuitable("Raster dimensions differ; align both observations to a common grid before comparison.")
    if a.get("transform") is not None and b.get("transform") is not None and a["transform"] != b["transform"]:
        raise ComparisonNotSuitable("Raster transforms differ; align both observations to a common grid before comparison.")
    jointly_valid = first.valid_mask & second.valid_mask
    overlap_pct = 100.0 * jointly_valid.sum() / jointly_valid.size if jointly_valid.size else 0.0
    if overlap_pct == 0:
        raise ComparisonNotSuitable("Observations have no jointly valid pixel overlap in the selected area.")
    warnings = []
    if overlap_pct < 50:
        warnings.append("Less than 50% of grid pixels are jointly valid across both observations.")
    for index, metadata in enumerate((a, b), start=1):
        cloud = metadata.get("cloud_cover_percent_scene")
        if cloud is not None and cloud > 50:
            warnings.append(f"Observation {index} scene-level cloud cover exceeds 50%; AOI validity is reported separately.")
    target_resolution = max(ra, rb)
    return {
        "compatible_bands": common_bands,
        "target_resolution_m": target_resolution,
        "joint_valid_pixel_coverage_percent": float(overlap_pct),
        "joint_valid_mask": jointly_valid,
        "first_layers": {name: first.bands[name] for name in common_bands},
        "second_layers": {name: second.bands[name] for name in common_bands},
        "warnings": warnings,
        "processing_status": "ready",
        "nodata_policy": "Comparison is limited to pixels valid in both observations; invalid pixels remain masked.",
    }
