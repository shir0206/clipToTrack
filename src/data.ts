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
  /** [lng, lat] */
  coordinates: [number, number][];
};

export const ROUTE_COLOR_TOKENS = {
  blue: '#2878FF',
  orange: '#FF7A1A',
  green: '#14A44D',
  violet: '#8B5CF6',
  pink: '#EC4899',
  cyan: '#0891B2',
  gold: '#D6A000',
  red: '#E24343',
} as const;

export const ROUTE_COLORS = Object.values(ROUTE_COLOR_TOKENS);

// Mock data – replace with parsed GoPro telemetry.
export const MOCK_CLIPS: Clip[] = [
  {
    id: 'clip-01',
    index: 1,
    title: 'Alpine Descent',
    date: 'Jun 14, 2024 · 10:24 AM',
    color: ROUTE_COLOR_TOKENS.blue,
    duration: '04:32',
    distance: '8.4 km',
    maxSpeed: '62 km/h',
    altitude: '2,317 m',
    coordinates: [
      [7.832, 46.121],
      [7.838, 46.118],
      [7.846, 46.119],
      [7.852, 46.113],
      [7.861, 46.112],
      [7.868, 46.106],
    ],
  },
  {
    id: 'clip-02',
    index: 2,
    title: 'Forest Flow',
    date: 'Jun 14, 2024 · 1:03 PM',
    color: ROUTE_COLOR_TOKENS.orange,
    duration: '06:18',
    distance: '11.2 km',
    maxSpeed: '48 km/h',
    altitude: '1,842 m',
    coordinates: [
      [7.795, 46.098],
      [7.803, 46.101],
      [7.811, 46.097],
      [7.818, 46.103],
      [7.826, 46.099],
      [7.829, 46.091],
    ],
  },
  {
    id: 'clip-03',
    index: 3,
    title: 'Lakeside Cruise',
    date: 'Jun 13, 2024 · 4:21 PM',
    color: ROUTE_COLOR_TOKENS.green,
    duration: '03:47',
    distance: '6.1 km',
    maxSpeed: '36 km/h',
    altitude: '1,210 m',
    coordinates: [
      [7.842, 46.094],
      [7.848, 46.092],
      [7.855, 46.093],
      [7.861, 46.089],
      [7.864, 46.083],
    ],
  },
];
