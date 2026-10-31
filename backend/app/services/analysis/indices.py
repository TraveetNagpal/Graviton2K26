"""Numerical spectral-index calculations for local arrays and unit tests."""
from __future__ import annotations
from typing import Any, Optional, Union

import numpy as np


def normalized_difference(first: np.ndarray, second: np.ndarray, *, valid_mask: Optional[np.ndarray] = None, epsilon: float = 1e-6) -> np.ndarray:
    """Calculate (second-first)/(second+first); invalid values become NaN."""
    first_array, second_array = np.broadcast_arrays(np.asarray(first, dtype=np.float64), np.asarray(second, dtype=np.float64))
    denominator = second_array + first_array
    valid = np.isfinite(first_array) & np.isfinite(second_array) & np.isfinite(denominator) & (np.abs(denominator) > epsilon)
    if valid_mask is not None:
        valid &= np.broadcast_to(np.asarray(valid_mask, dtype=bool), valid.shape)
    result = np.full(valid.shape, np.nan, dtype=np.float64)
    np.divide(second_array - first_array, denominator, out=result, where=valid)
    return result


def ndvi(red: np.ndarray, nir: np.ndarray, *, valid_mask: Optional[np.ndarray] = None, epsilon: float = 1e-6) -> np.ndarray:
    """NDVI=(NIR-Red)/(NIR+Red)."""
    return normalized_difference(red, nir, valid_mask=valid_mask, epsilon=epsilon)


def ndwi(green: np.ndarray, nir: np.ndarray, *, valid_mask: Optional[np.ndarray] = None, epsilon: float = 1e-6) -> np.ndarray:
    """McFeeters NDWI=(Green-NIR)/(Green+NIR), commonly used for open water."""
    return normalized_difference(nir, green, valid_mask=valid_mask, epsilon=epsilon)


def ndbi(nir: np.ndarray, swir1: np.ndarray, *, valid_mask: Optional[np.ndarray] = None, epsilon: float = 1e-6) -> np.ndarray:
    """NDBI=(SWIR1-NIR)/(SWIR1+NIR); a built-up proxy, not a building detector."""
    return normalized_difference(nir, swir1, valid_mask=valid_mask, epsilon=epsilon)


def difference(later: np.ndarray, earlier: np.ndarray, *, valid_mask: Optional[np.ndarray] = None) -> np.ndarray:
    """Later minus earlier, with invalid/masked pairs retained as NaN."""
    late, early = np.broadcast_arrays(np.asarray(later, dtype=np.float64), np.asarray(earlier, dtype=np.float64))
    valid = np.isfinite(late) & np.isfinite(early)
    if valid_mask is not None:
        valid &= np.broadcast_to(np.asarray(valid_mask, dtype=bool), valid.shape)
    out = np.full(valid.shape, np.nan, dtype=np.float64)
    np.subtract(late, early, out=out, where=valid)
    return out


def threshold_change(index_difference: np.ndarray, *, threshold: float) -> np.ndarray:
    """Encode decrease=-1, stable=0, increase=1; invalid pixels remain NaN."""
    if threshold <= 0:
        raise ValueError("threshold must be greater than zero")
    values = np.asarray(index_difference, dtype=np.float64)
    out = np.full(values.shape, np.nan, dtype=np.float64)
    valid = np.isfinite(values)
    out[valid] = 0
    out[valid & (values <= -threshold)] = -1
    out[valid & (values >= threshold)] = 1
    return out


def area_for_mask(mask: np.ndarray, pixel_area_m2: Union[float, np.ndarray]) -> dict[str, Any]:
    """Measure mapped area from explicit pixel areas; invalid area values are skipped."""
    selected = np.asarray(mask, dtype=bool)
    area = np.broadcast_to(np.asarray(pixel_area_m2, dtype=np.float64), selected.shape)
    valid = selected & np.isfinite(area) & (area > 0)
    area_m2 = float(area[valid].sum())
    return {"pixel_count": int(valid.sum()), "area_m2": area_m2, "area_ha": area_m2 / 10_000, "area_km2": area_m2 / 1_000_000}


def valid_pixel_coverage(valid_mask: np.ndarray) -> dict[str, Any]:
    valid = np.asarray(valid_mask, dtype=bool)
    count = int(valid.sum())
    total = int(valid.size)
    return {"valid_pixel_count": count, "total_pixel_count": total, "valid_pixel_coverage_percent": 100 * count / total if total else 0.0}
