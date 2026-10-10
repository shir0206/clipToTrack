import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Clip } from '../../types';
import ElevationProfile, { TelemetryReadout } from './ElevationProfile';

const clip: Clip = {
  id: 'clip-1',
  index: 0,
  title: 'GX010683',
  date: '2026-10-10',
  color: '#2878FF',
  duration: '0:02',
  distance: '20 m',
  maxSpeed: '30 km/h',
  altitude: '920 m',
  camera: 'HERO13 Black',
  gpsQuality: '3D fix',
  coordinates: [
    [-6.1, 53.3],
    [-6.11, 53.31],
  ],
  samples: [
    {
      lat: 53.3,
      lon: -6.1,
      altM: 914.4,
      speed3dKmh: 12.2,
      cumulativeDistM: 0,
    },
    {
      lat: 53.31,
      lon: -6.11,
      altM: 920.4,
      speed3dKmh: 30.2,
      cumulativeDistM: 20,
    },
  ],
  addedAt: 1,
  sort: {},
};

describe('ElevationProfile telemetry readout', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
  });

  it('offers a Values display mode beside the existing graph and dial modes', () => {
    const html = renderToStaticMarkup(
      <ElevationProfile
        clip={clip}
        probe={1}
        onProbe={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('Values');
  });

  it('writes the desktop dock height to the CSS variable used by the panel', () => {
    const html = renderToStaticMarkup(
      <ElevationProfile
        clip={clip}
        probe={1}
        onProbe={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(html).toContain('--height:260px');
    expect(html).not.toContain('--h:260px');
  });

  it('shows altitude and speed numbers from the current probe sample', () => {
    const html = renderToStaticMarkup(
      <TelemetryReadout clip={clip} probe={1} />,
    );

    expect(html).toContain('Altitude');
    expect(html).toContain('920');
    expect(html).toContain('m');
    expect(html).toContain('Speed');
    expect(html).toContain('30');
    expect(html).toContain('km/h');
    expect(html).toContain('Altitude 920 meters, speed 30 kilometers per hour');
    expect(html).toContain('telemetry-digit-strip');
    expect(html).toContain('--digit:9');
    expect(html).toContain('--digit:3');
  });

  it('renders the numbers pane without the graph header chrome', () => {
    const html = renderToStaticMarkup(
      <ElevationProfile
        clip={clip}
        probe={1}
        onProbe={vi.fn()}
        onClose={vi.fn()}
        initialModes={{ alt: 'readout' }}
      />,
    );

    expect(html).toContain('class="profile-pane is-readout"');
    expect(html).not.toContain('class="pane-header"');
    expect(html).toContain('class="icon-button pane-popover"');
  });
});
