/**
 * Virtual engine for the tachometer.
 *
 * A GoPro has no RPM sensor, so we model a typical road car and ask:
 * "at this speed, on this slope, at this altitude, what would the engine be doing?"
 *
 *  1. Road load   – aero drag + rolling resistance + climbing (grade) + acceleration
 *  2. Thin air    – an air-breathing engine makes less power with altitude (density ratio),
 *                   so the same road load is a *bigger share* of what is available => higher load
 *  3. Gear choice – the higher the load, the lower the gear the driver/ECU holds (more revs)
 *  4. RPM         – wheel speed x gear ratio x final drive, never below idle
 *
 * It is stateless (same input => same output), so scrubbing the map or the video never "drifts".
 * The gear can therefore hop at shift points; the needle's CSS transition smooths it.
 */

export const ENGINE = {
  idleRpm: 900,
  redlineRpm: 6500,
  /** top of the tachometer scale */
  maxRpm: 8000,
  /** 6-speed box */
  gears: [3.62, 2.19, 1.52, 1.15, 0.92, 0.76],
  finalDrive: 3.9,
  wheelRadiusM: 0.33,
  massKg: 1400,
  /** drag coefficient x frontal area, m² */
  cdA: 0.65,
  /** rolling resistance coefficient */
  crr: 0.012,
  drivetrainEff: 0.88,
  /** peak power at sea level */
  peakPowerW: 110_000,
} as const;

const G = 9.81;
const RHO_SEA_LEVEL = 1.225; // kg/m³
const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n));

export type EngineInput = {
  speedKmh: number;
  /** metres above sea level (default 0) */
  altM?: number;
  /** road slope in %, + uphill (default 0) */
  gradePct?: number;
  /** m/s², + speeding up (default 0) */
  accelMs2?: number;
};

export type EngineState = {
  rpm: number;
  /** 0 = stopped / neutral, 1..6 */
  gear: number;
  /** 0..1 share of the available power being used */
  load: number;
  /** air density relative to sea level (1 = sea level) */
  airDensity: number;
};

/** Barometric (ISA) air density relative to sea level. ~0.78 at 2000 m. */
export const airDensityRatio = (altM = 0) =>
  Math.pow(1 - 2.25577e-5 * clamp(altM, -400, 11000), 4.25588);

const rpmInGear = (vMs: number, gearIdx: number) =>
  (vMs / (2 * Math.PI * ENGINE.wheelRadiusM)) *
  60 *
  ENGINE.gears[gearIdx] *
  ENGINE.finalDrive;

export function estimateEngine({
  speedKmh,
  altM = 0,
  gradePct = 0,
  accelMs2 = 0,
}: EngineInput): EngineState {
  const v = Math.max(0, speedKmh) / 3.6;
  const density = airDensityRatio(altM);

  if (v < 0.5)
    return { rpm: ENGINE.idleRpm, gear: 0, load: 0, airDensity: density };

  // 1) road load (N) -> power at the crank (W)
  const theta = Math.atan(gradePct / 100);
  const force =
    0.5 * RHO_SEA_LEVEL * density * ENGINE.cdA * v * v + // aero (less air up high)
    ENGINE.crr * ENGINE.massKg * G * Math.cos(theta) + // rolling
    ENGINE.massKg * G * Math.sin(theta) + // climbing / descending
    ENGINE.massKg * accelMs2; // accelerating
  const power = Math.max(0, (force * v) / ENGINE.drivetrainEff);

  // 2) thin air: less power available, so the same demand is a higher load
  const load = clamp(power / (ENGINE.peakPowerW * density), 0, 1);

  // 3) gear choice: stay in the highest gear that is still above the "lug" limit,
  //    which rises with load (climbing / accelerating / thin air => lower gear)
  const lugRpm = 1400 + 1800 * Math.sqrt(load);
  let gearIdx = 0;
  for (let g = ENGINE.gears.length - 1; g >= 0; g--) {
    const r = rpmInGear(v, g);
    if (r >= lugRpm && r <= ENGINE.redlineRpm) {
      gearIdx = g;
      break;
    }
  }

  // 4) revs (idle floor covers clutch slip in 1st)
  const rpm = clamp(rpmInGear(v, gearIdx), ENGINE.idleRpm, ENGINE.maxRpm);
  return { rpm, gear: gearIdx + 1, load, airDensity: density };
}
