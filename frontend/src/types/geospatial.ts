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
