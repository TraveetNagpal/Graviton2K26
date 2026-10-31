export interface Measurement {
  name: string;
  value: number | string | null;
  unit?: string;
  date?: string;
}

export interface ReportRecord {
  id: string;
  title: string;
  region?: string;
  createdAt: string;
  analysisType: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | string;
  observationDates?: string[];
  analysisMethod?: string;
  dataset?: string;
  measurements?: Measurement[];
  geojsonAvailable?: boolean;
  downloads?: Partial<Record<'pdf' | 'csv' | 'geojson', string>>;
  error?: string;
}

export interface ReportResponse {
  report: ReportRecord;
  pdfUrl?: string;
  csvUrl?: string;
  geojsonUrl?: string;
}
