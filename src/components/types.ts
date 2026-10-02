/** One GPS sample. Extra fields are optional because older stored clips / hand-made JSON may lack them. */
export type GpsPoint = {
  lat: number;
  lon: number;
  altM?: number;
  speed3dKmh?: number;
  utc?: string;
  index?: number;
  speed2dMs?: number;
  speed3dMs?: number;
  dop?: number;
  fix?: number;
  segmentDistM?: number;
  cumulativeDistM?: number;
};

export type DetailGroup = {
  title: string;
  rows: [label: string, value: string][];
};

export type Clip = {
  id: string;
  index: number;
  title: string;
  date: string;
  color: string;
  thumbnail?: string; // optional image url (JPEG data URL captured from the video)
  /** Object URL of the local MP4. Session-only: not persisted, so it's missing after a reload. */
  videoUrl?: string;
  duration: string;
  distance: string;
  maxSpeed: string;
  altitude: string;
  /** e.g. "HERO13 Black · 5.3K · 25 fps" */
  camera: string;
  /** e.g. "3D fix · DOP 1.37 · 65 pts" */
  gpsQuality: string;
  /** [lng, lat] */
  coordinates: [number, number][];
  /** Full metadata of each point; samples[i] belongs to coordinates[i]. */
  samples: GpsPoint[];
  /** Epoch ms when the clip was added (for "upload time" sorting). */
  addedAt: number;
  /** Raw numbers used for sorting; undefined when the source lacks the field. */
  sort: {
    date?: number;
    duration?: number;
    distance?: number;
    speed?: number;
    altitude?: number;
  };
  /** Extra metadata worth showing (only the fields that exist in the source). */
  details?: DetailGroup[];
};

export const ROUTE_COLORS = [
  '#2878FF',
  '#FF7A1A',
  '#14A44D',
  '#8B5CF6',
  '#EC4899',
  '#0891B2',
  '#D6A000',
  '#E24343',
];

/** Live status while files are being read (drives the progress bar in the upload zone). */
export type UploadProgress = {
  name: string;
  /** 1-based position in the current batch */
  n: number;
  of: number;
  phase: 'index' | 'telemetry' | 'thumbnail';
  /** 0..1, or null when the step has no measurable progress */
  frac: number | null;
};
