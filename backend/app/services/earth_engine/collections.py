"""Earth Engine collection definitions and preprocessing rules."""
from __future__ import annotations
from dataclasses import dataclass
from typing import Any, Callable, Optional


@dataclass(frozen=True)
class DatasetConfig:
    key: str
    description: str
    collection_ids: tuple[str, ...]
    cloud_property: Optional[str]
    resolution_m: int
    source_bands: tuple[str, ...]
    preprocess: Callable[[Any], Any]


def _sentinel2(image):
    scl = image.select("SCL")
    clear = scl.neq(0).And(scl.neq(1)).And(scl.neq(3)).And(scl.neq(8)).And(scl.neq(9)).And(scl.neq(10)).And(scl.neq(11))
    return image.updateMask(clear).select("B.*").multiply(0.0001)


def _landsat_c2(image):
    qa = image.select("QA_PIXEL")
    clear = qa.bitwiseAnd(1).eq(0)
    for bit in (1, 2, 3, 4, 5):
        clear = clear.And(qa.bitwiseAnd(1 << bit).eq(0))
    scaled = image.select("SR_B.*").multiply(0.0000275).add(-0.2)
    return image.addBands(scaled, overwrite=True).updateMask(clear)


SENTINEL_BANDS = ("B2", "B3", "B4", "B8", "B11", "B12")
LANDSAT_BANDS = ("SR_B2", "SR_B3", "SR_B4", "SR_B5", "SR_B6", "SR_B7")
DATASETS = {
    "sentinel-2": DatasetConfig("sentinel-2", "Sentinel-2 MSI Level-2A SR harmonized", ("COPERNICUS/S2_SR_HARMONIZED",), "CLOUDY_PIXEL_PERCENTAGE", 20, SENTINEL_BANDS, _sentinel2),
    "landsat-8": DatasetConfig("landsat-8", "Landsat 8 Collection 2 Tier 1 Level 2", ("LANDSAT/LC08/C02/T1_L2",), "CLOUD_COVER", 30, LANDSAT_BANDS, _landsat_c2),
    "landsat-9": DatasetConfig("landsat-9", "Landsat 9 Collection 2 Tier 1 Level 2", ("LANDSAT/LC09/C02/T1_L2",), "CLOUD_COVER", 30, LANDSAT_BANDS, _landsat_c2),
    "landsat": DatasetConfig("landsat", "Landsat 8 and 9 Collection 2 Tier 1 Level 2", ("LANDSAT/LC08/C02/T1_L2", "LANDSAT/LC09/C02/T1_L2"), "CLOUD_COVER", 30, LANDSAT_BANDS, _landsat_c2),
}
CANONICAL_BANDS = ("blue", "green", "red", "nir", "swir1", "swir2")
