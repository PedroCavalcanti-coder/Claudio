export interface SeriesInfo {
  id:                  string;
  series_instance_uid: string;
  series_number:       number;
  series_description:  string;
  modality:            string;
  number_of_instances: number;
  thumbnail_url?:      string;
  instances:           InstanceInfo[];
}

export interface InstanceInfo {
  id:               string;
  sop_instance_uid: string;
  instance_number:  number;
  rows:             number;
  columns:          number;
  number_of_frames: number;
}

export interface StudyMeta {
  study_instance_uid: string;
  study_date?:        string;
  modality_type?:     string;
  patient_name?:      string;
  patient_id?:        string;
  accession_number?:  string;
  wado_url?:          string;
  series:             SeriesInfo[];
}

export type LayoutMode = '1x1' | '1x2' | '2x1' | '2x2' | 'mpr';

export type ToolName =
  | 'WindowLevel'
  | 'Pan'
  | 'Zoom'
  | 'Length'
  | 'Angle'
  | 'EllipticalROI'
  | 'RectangleROI'
  | 'ArrowAnnotate'
  | 'Bidirectional'
  | 'CobbAngle'
  | 'Probe'
  | 'StackScroll';

export interface ViewportState {
  seriesIndex: number;
  instanceIndex: number;
  ww: number;
  wc: number;
  invert: boolean;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

export interface WLPreset {
  name:  string;
  ww:    number;
  wc:    number;
}
