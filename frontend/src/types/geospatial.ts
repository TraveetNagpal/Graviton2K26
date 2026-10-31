export type InvestigatorEvidence = {
  analysis_id: string;
  analysis_type: "vegetation" | "water" | "urban";
  region: Record<string, unknown>;
  observation_dates: { earlier: string; later: string };
  datasets: Record<string, unknown>;
  analysis_method: string;
  measurements: Record<string, number | null>;
  valid_pixel_coverage_percent: number;
  quality_warnings: string[];
  uncertainty: Record<string, unknown>;
  change_layer: { name: string; layers_endpoint: string };
  layers_url: string;
  report_url?: string | null;
};

export type InvestigationResponse = {
  status: string;
  question?: string;
  finding?: string;
  evidence?: InvestigatorEvidence;
  interpretation?: string;
  limitations?: string[];
  next_step?: string;
  llm_status?: string;
  analysis_id?: string;
  progress_url?: string;
  layers_url?: string;
  message?: string;
  answer?: string;
};

export type SatelliteObservation = {
  date: string; dataset: string; image_id: string; dataset_id: string;
  cloud_cover?: number | null; quality: Record<string, unknown>;
};

export type TrendDatum = {
  metric: string; value: number | null; unit: string;
};

export type HistoricalPoint = {
  date: string; image_id: string; dataset: string; status: string;
  analysis_id?: string; value?: TrendDatum | null; change_from_baseline?: TrendDatum;
  source_metadata?: Record<string, unknown> | null;
  valid_pixel_coverage_percent?: number; quality_warnings?: string[]; warning?: string; layer_url?: string;
  layer_name?: string;
};

export type HistoricalTrend = {
  analysis_id: string; analysis_type: string; status: string;
  baseline: { date: string; image_id: string };
  points: HistoricalPoint[]; quality_warnings: string[]; measurement_definition: string;
  missing_observation_count: number;
};

export type TileLayer = { name: string; tile_url_template: string; visualization: Record<string, unknown> };
