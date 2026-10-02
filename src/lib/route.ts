import type { GpsPoint } from './gpmf/types';

export type RejectionReason =
  | 'latitude-out-of-range'
  | 'longitude-out-of-range'
  | 'invalid-timestamp'
  | 'gps-fix-too-low'
  | 'dop-too-high'
  | 'duplicate-timestamp'
  | 'non-monotonic-timestamp'
  | 'impossible-jump';

export interface RouteSmoothingOptions {
  enabled: boolean;
  smoothingFactor?: number;
  resetGapSeconds?: number;
}

export interface RouteAnalysisOptions {
  minFix?: number;
  maxDop?: number;
  maxJumpSpeedMps?: number;
  movingSpeedThresholdMps?: number;
  smoothing?: RouteSmoothingOptions;
}

export interface RejectedRoutePoint {
  point: GpsPoint;
  index: number;
  reasons: RejectionReason[];
}

export interface RouteStatistics {
  distanceMeters: number;
  durationSeconds: number;
  movingTimeSeconds: number;
  averageSpeedMps: number;
  averageSpeedKph: number;
  maxSpeedMps: number;
  maxSpeedKph: number;
  ascentMeters: number;
  descentMeters: number;
}

export interface RouteAnalysis {
  rawRoute: GpsPoint[];
  acceptedRoute: GpsPoint[];
  processedRoute: GpsPoint[];
  rejectedPoints: RejectedRoutePoint[];
  statistics: RouteStatistics;
}

const DEFAULT_MIN_FIX = 2;
const DEFAULT_MAX_DOP = 5;
const DEFAULT_MAX_JUMP_SPEED_MPS = 120;
const DEFAULT_MOVING_SPEED_THRESHOLD_MPS = 0.5;
const DEFAULT_SMOOTHING_FACTOR = 0.25;
const DEFAULT_RESET_GAP_SECONDS = 5;
const WGS84_A = 6_378_137;
const WGS84_F = 1 / 298.257_223_563;
const WGS84_B = (1 - WGS84_F) * WGS84_A;

function timestampMs(point: GpsPoint) {
  if (point.utcTime) {
    const parsed = Date.parse(point.utcTime);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  if (point.timestampSeconds !== undefined) {
    const timestamp = point.timestampSeconds * 1_000;
    return Number.isFinite(timestamp) ? timestamp : undefined;
  }
  return undefined;
}

function secondsBetween(from: GpsPoint, to: GpsPoint) {
  const start = timestampMs(from);
  const end = timestampMs(to);
  if (start === undefined || end === undefined) return undefined;
  return (end - start) / 1_000;
}

function radians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function wrapLongitude(longitude: number) {
  if (longitude < -180 || longitude > 180)
    return ((((longitude + 180) % 360) + 360) % 360) - 180;
  return longitude;
}

function shortestLongitudeDelta(from: number, to: number) {
  return ((((to - from + 180) % 360) + 360) % 360) - 180;
}

function haversineDistanceMeters(from: GpsPoint, to: GpsPoint) {
  const meanEarthRadius = 6_371_008.8;
  const lat1 = radians(from.latitude);
  const lat2 = radians(to.latitude);
  const deltaLat = lat2 - lat1;
  const deltaLon = radians(to.longitude - from.longitude);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return 2 * meanEarthRadius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function geodesicDistanceMeters(from: GpsPoint, to: GpsPoint) {
  const u1 = Math.atan((1 - WGS84_F) * Math.tan(radians(from.latitude)));
  const u2 = Math.atan((1 - WGS84_F) * Math.tan(radians(to.latitude)));
  const sinU1 = Math.sin(u1);
  const cosU1 = Math.cos(u1);
  const sinU2 = Math.sin(u2);
  const cosU2 = Math.cos(u2);
  const longitudeDelta = radians(to.longitude - from.longitude);
  let lambda = longitudeDelta;
  let previousLambda = 0;
  let sinSigma = 0;
  let cosSigma = 0;
  let sigma = 0;
  let sinAlpha: number;
  let cosSqAlpha = 0;
  let cos2SigmaM = 0;

  for (let iteration = 0; iteration < 100; iteration += 1) {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    sinSigma = Math.sqrt(
      (cosU2 * sinLambda) ** 2 +
        (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) ** 2,
    );
    if (sinSigma === 0) return 0;
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cosSqAlpha = 1 - sinAlpha ** 2;
    cos2SigmaM =
      cosSqAlpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cosSqAlpha;
    const c =
      (WGS84_F / 16) * cosSqAlpha * (4 + WGS84_F * (4 - 3 * cosSqAlpha));
    previousLambda = lambda;
    lambda =
      longitudeDelta +
      (1 - c) *
        WGS84_F *
        sinAlpha *
        (sigma +
          c *
            sinSigma *
            (cos2SigmaM + c * cosSigma * (-1 + 2 * cos2SigmaM ** 2)));
    if (Math.abs(lambda - previousLambda) < 1e-12) break;
  }

  if (Math.abs(lambda - previousLambda) >= 1e-12)
    return haversineDistanceMeters(from, to);

  const uSq = (cosSqAlpha * (WGS84_A ** 2 - WGS84_B ** 2)) / WGS84_B ** 2;
  const a =
    1 + (uSq / 16_384) * (4_096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const b = (uSq / 1_024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma =
    b *
    sinSigma *
    (cos2SigmaM +
      (b / 4) *
        (cosSigma * (-1 + 2 * cos2SigmaM ** 2) -
          (b / 6) *
            cos2SigmaM *
            (-3 + 4 * sinSigma ** 2) *
            (-3 + 4 * cos2SigmaM ** 2)));
  return WGS84_B * a * (sigma - deltaSigma);
}

function rejectionReasons(
  point: GpsPoint,
  previousAccepted: GpsPoint | undefined,
  seenTimestamps: Set<number>,
  options: Required<
    Pick<RouteAnalysisOptions, 'minFix' | 'maxDop' | 'maxJumpSpeedMps'>
  >,
) {
  const reasons: RejectionReason[] = [];
  const time = timestampMs(point);
  if (
    !Number.isFinite(point.latitude) ||
    point.latitude < -90 ||
    point.latitude > 90
  )
    reasons.push('latitude-out-of-range');
  if (
    !Number.isFinite(point.longitude) ||
    point.longitude < -180 ||
    point.longitude > 180
  )
    reasons.push('longitude-out-of-range');
  if (time === undefined) reasons.push('invalid-timestamp');
  if (point.fix === undefined || point.fix < options.minFix)
    reasons.push('gps-fix-too-low');
  if (point.dop !== undefined && point.dop > options.maxDop)
    reasons.push('dop-too-high');
  if (time !== undefined && seenTimestamps.has(time))
    reasons.push('duplicate-timestamp');

  if (previousAccepted && time !== undefined) {
    const previousTime = timestampMs(previousAccepted);
    if (previousTime !== undefined) {
      const deltaSeconds = (time - previousTime) / 1_000;
      if (deltaSeconds < 0) reasons.push('non-monotonic-timestamp');
      else if (
        deltaSeconds > 0 &&
        geodesicDistanceMeters(previousAccepted, point) / deltaSeconds >
          options.maxJumpSpeedMps
      )
        reasons.push('impossible-jump');
    }
  }

  return reasons;
}

function acceptedPoints(
  rawRoute: GpsPoint[],
  options: Required<
    Pick<RouteAnalysisOptions, 'minFix' | 'maxDop' | 'maxJumpSpeedMps'>
  >,
) {
  const accepted: GpsPoint[] = [];
  const rejected: RejectedRoutePoint[] = [];
  const seenTimestamps = new Set<number>();

  rawRoute.forEach((point, index) => {
    const time = timestampMs(point);
    const reasons = rejectionReasons(
      point,
      accepted.at(-1),
      seenTimestamps,
      options,
    );
    if (time !== undefined) seenTimestamps.add(time);
    if (reasons.length > 0) rejected.push({ point, index, reasons });
    else accepted.push({ ...point });
  });

  return { accepted, rejected };
}

function smoothRoute(
  route: GpsPoint[],
  options: Required<RouteSmoothingOptions>,
) {
  if (route.length < 2) return route.map((point) => ({ ...point }));

  const smoothed: GpsPoint[] = [{ ...route[0] }];
  for (let index = 1; index < route.length; index += 1) {
    const previous = smoothed[index - 1];
    const current = route[index];
    const deltaSeconds = secondsBetween(route[index - 1], current);
    if (
      deltaSeconds === undefined ||
      deltaSeconds < 0 ||
      deltaSeconds > options.resetGapSeconds
    ) {
      smoothed.push({ ...current });
      continue;
    }
    const alpha = 1 - Math.exp(-options.smoothingFactor * deltaSeconds);
    smoothed.push({
      ...current,
      latitude:
        previous.latitude + alpha * (current.latitude - previous.latitude),
      longitude: wrapLongitude(
        previous.longitude +
          alpha * shortestLongitudeDelta(previous.longitude, current.longitude),
      ),
      altitude:
        previous.altitude + alpha * (current.altitude - previous.altitude),
      speed2d: previous.speed2d + alpha * (current.speed2d - previous.speed2d),
      speed3d: previous.speed3d + alpha * (current.speed3d - previous.speed3d),
    });
  }
  return smoothed;
}

function routeStatistics(
  route: GpsPoint[],
  movingSpeedThresholdMps: number,
): RouteStatistics {
  let distanceMeters = 0;
  let movingTimeSeconds = 0;
  let ascentMeters = 0;
  let descentMeters = 0;
  let maxSpeedMps = 0;

  for (const point of route)
    if (Number.isFinite(point.speed2d))
      maxSpeedMps = Math.max(maxSpeedMps, point.speed2d);

  for (let index = 1; index < route.length; index += 1) {
    const previous = route[index - 1];
    const current = route[index];
    const segmentDistance = geodesicDistanceMeters(previous, current);
    const deltaSeconds = secondsBetween(previous, current) ?? 0;
    distanceMeters += segmentDistance;
    if (deltaSeconds > 0) {
      const segmentSpeed = segmentDistance / deltaSeconds;
      if (
        Math.max(segmentSpeed, previous.speed2d, current.speed2d) >=
        movingSpeedThresholdMps
      )
        movingTimeSeconds += deltaSeconds;
    }
    const altitudeDelta = current.altitude - previous.altitude;
    if (altitudeDelta > 0) ascentMeters += altitudeDelta;
    else descentMeters += Math.abs(altitudeDelta);
  }

  const first = route[0];
  const last = route.at(-1);
  const durationSeconds =
    first && last ? Math.max(secondsBetween(first, last) ?? 0, 0) : 0;
  const averageSpeedMps =
    durationSeconds > 0 ? distanceMeters / durationSeconds : 0;

  return {
    distanceMeters,
    durationSeconds,
    movingTimeSeconds,
    averageSpeedMps,
    averageSpeedKph: averageSpeedMps * 3.6,
    maxSpeedMps,
    maxSpeedKph: maxSpeedMps * 3.6,
    ascentMeters,
    descentMeters,
  };
}

export function buildRouteAnalysis(
  gps: GpsPoint[],
  options: RouteAnalysisOptions = {},
): RouteAnalysis {
  const rawRoute = gps.map((point) => ({ ...point }));
  const { accepted, rejected } = acceptedPoints(rawRoute, {
    minFix: options.minFix ?? DEFAULT_MIN_FIX,
    maxDop: options.maxDop ?? DEFAULT_MAX_DOP,
    maxJumpSpeedMps: options.maxJumpSpeedMps ?? DEFAULT_MAX_JUMP_SPEED_MPS,
  });
  const smoothing = options.smoothing ?? { enabled: false };
  const processedRoute = smoothing.enabled
    ? smoothRoute(accepted, {
        enabled: true,
        smoothingFactor: smoothing.smoothingFactor ?? DEFAULT_SMOOTHING_FACTOR,
        resetGapSeconds: smoothing.resetGapSeconds ?? DEFAULT_RESET_GAP_SECONDS,
      })
    : accepted.map((point) => ({ ...point }));

  return {
    rawRoute,
    acceptedRoute: accepted,
    processedRoute,
    rejectedPoints: rejected,
    statistics: routeStatistics(
      accepted,
      options.movingSpeedThresholdMps ?? DEFAULT_MOVING_SPEED_THRESHOLD_MPS,
    ),
  };
}
