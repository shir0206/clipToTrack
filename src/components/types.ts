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
