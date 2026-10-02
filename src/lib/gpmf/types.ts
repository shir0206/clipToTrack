export const TELEMETRY_SCHEMA_VERSION = 1 as const;

export type TelemetryScalar = number | string;
export type TelemetryValue = TelemetryScalar | TelemetryScalar[];

export interface TelemetryReading {
  timestampSeconds?: number;
  utcTime?: string;
  values: TelemetryValue;
  rawValues: TelemetryValue;
}

export interface TelemetryStream {
  key: string;
  name: string;
  category:
    | 'gps'
    | 'motion'
    | 'orientation'
    | 'imaging'
    | 'environment'
    | 'audio'
    | 'other';
  type: string;
  units: string[];
  siUnits: string[];
  scale: number[];
  orientation?: string;
  sourceFile?: string;
  sourceSampleIndex: number;
  timestampSeconds?: number;
  totalSamples?: number;
  values: TelemetryValue[];
  samples: TelemetryReading[];
}

export interface GpsPoint {
  latitude: number;
  longitude: number;
  altitude: number;
  speed2d: number;
  speed3d: number;
  daysSince2000?: number;
  secondsSinceMidnight?: number;
  dop?: number;
  fix?: number;
  timestampSeconds?: number;
  utcTime?: string;
  sourceFile?: string;
  sourceSampleIndex: number;
}

export interface UnknownGpmfRecord {
  key: string;
  type: string;
  structSize: number;
  repeat: number;
  sourceFile?: string;
  sourceSampleIndex: number;
  rawPayload: Uint8Array;
}

export interface DecodedTelemetry {
  version: typeof TELEMETRY_SCHEMA_VERSION;
  streams: TelemetryStream[];
  gps: GpsPoint[];
  unknownRecords: UnknownGpmfRecord[];
}
