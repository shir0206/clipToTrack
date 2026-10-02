export type Clip = {
  id: string;
  index: number;
  title: string;
  date: string;
  color: string;
  thumbnail?: string; // optional image url
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
};

export const ROUTE_COLORS = [
  '#2878FF', '#FF7A1A', '#14A44D', '#8B5CF6',
  '#EC4899', '#0891B2', '#D6A000', '#E24343',
];
