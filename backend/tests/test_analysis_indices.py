import numpy as np
import pytest

from app.services.analysis.indices import area_for_mask, difference, ndbi, ndvi, ndwi, threshold_change, valid_pixel_coverage


def test_ndvi_and_later_minus_earlier_difference_known_values():
    earlier = ndvi(np.array([0.2, 0.4]), np.array([0.6, 0.4]))
    later = ndvi(np.array([0.3, 0.2]), np.array([0.5, 0.6]))
    delta = difference(later, earlier)
    np.testing.assert_allclose(earlier, [0.5, 0.0])
    np.testing.assert_allclose(later, [0.25, 0.5])
    np.testing.assert_allclose(delta, [-0.25, 0.5])


def test_ndwi_and_ndbi_use_dataset_semantic_bands():
    assert ndwi(np.array([0.5]), np.array([0.1]))[0] == pytest.approx(2 / 3)
    assert ndbi(np.array([0.2]), np.array([0.6]))[0] == pytest.approx(0.5)


def test_invalid_denominator_nan_and_cloud_mask_remain_missing():
    values = ndvi(np.array([0.0, 0.2, 0.2]), np.array([0.0, 0.6, 0.6]), valid_mask=np.array([True, True, False]))
    assert np.isnan(values[0])
    assert values[1] == pytest.approx(0.5)
    assert np.isnan(values[2])


def test_threshold_categories_respect_configured_cutoff_and_preserve_nodata():
    result = threshold_change(np.array([-0.09, -0.1, 0.04, 0.1, np.nan]), threshold=0.1)
    np.testing.assert_equal(result[:4], [0, -1, 0, 1])
    assert np.isnan(result[4])
    with pytest.raises(ValueError, match="greater than zero"):
        threshold_change(np.array([0.0]), threshold=0)


def test_geographic_area_sums_only_selected_positive_finite_pixel_areas():
    result = area_for_mask(
        np.array([[True, True], [False, True]]),
        np.array([[900.0, 900.0], [900.0, np.nan]]),
    )
    assert result["pixel_count"] == 2
    assert result["area_m2"] == pytest.approx(1800)
    assert result["area_ha"] == pytest.approx(0.18)


def test_valid_coverage_counts_masked_pixels_as_invalid():
    result = valid_pixel_coverage(np.array([[True, False], [True, False]]))
    assert result == {"valid_pixel_count": 2, "total_pixel_count": 4, "valid_pixel_coverage_percent": 50}
