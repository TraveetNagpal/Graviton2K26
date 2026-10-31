"""Small in-memory QA checks; these do not contact Earth Engine."""
import numpy as np
import pytest

from app.services.earth_engine.local import ComparisonNotSuitable, prepare_comparison, prepare_local_raster


def test_sentinel_masks_cloud_shadow_and_nodata_and_scales_reflectance():
    data = np.full((2, 2, 3), 5000, dtype=np.uint16)
    data[0, 0, 2] = 0
    scl = np.array([[4, 3, 8], [4, 4, 10]], dtype=np.uint8)
    result = prepare_local_raster("sentinel-2", data, ["B4", "B8"], qa=scl, nodata=0, resolution_m=20, crs="EPSG:32643")
    assert result.bands["B4"][0, 0] == pytest.approx(0.5)
    assert not result.valid_mask[0, 1]
    assert not result.valid_mask[0, 2]
    assert not result.valid_mask[1, 2]
    assert result.metadata["valid_pixel_coverage_percent"] == pytest.approx(50.0)


def test_landsat_c2_scale_offset_and_quality_bits():
    data = np.full((1, 2, 2), 10000, dtype=np.uint16)
    qa = np.array([[0, 1 << 3], [1 << 4, 1]], dtype=np.uint16)
    result = prepare_local_raster("landsat-8", data, ["SR_B4"], qa=qa, resolution_m=30, crs="EPSG:32643")
    assert result.bands["SR_B4"][0, 0] == pytest.approx(0.075)
    assert int(result.valid_mask.sum()) == 1


def test_missing_pixels_remain_nan_and_missing_qa_is_reported():
    data = np.array([[[0, 10000]]], dtype=np.uint16)
    result = prepare_local_raster("landsat", data, ["SR_B4"], nodata=0, resolution_m=30, crs="EPSG:32643")
    assert np.isnan(result.bands["SR_B4"][0, 0])
    assert result.bands["SR_B4"][0, 1] == pytest.approx(0.075)
    assert any("No dataset QA" in warning for warning in result.metadata["warnings"])


def _scene(*, resolution=20, crs="EPSG:32643", transform="grid"):
    data = np.ones((1, 2, 2), dtype=np.uint16)
    qa = np.full((2, 2), 4, dtype=np.uint8)
    return prepare_local_raster("sentinel-2", data, ["red"], qa=qa, resolution_m=resolution, crs=crs, transform=transform)


def test_comparison_reports_jointly_valid_coverage():
    result = prepare_comparison(_scene(), _scene())
    assert result["compatible_bands"] == ["red"]
    assert result["joint_valid_pixel_coverage_percent"] == 100


@pytest.mark.parametrize("second", [_scene(crs="EPSG:4326"), _scene(transform="shifted"), _scene(resolution=60)])
def test_comparison_rejects_incompatible_crs_grid_or_resolution(second):
    with pytest.raises(ComparisonNotSuitable):
        prepare_comparison(_scene(), second)
