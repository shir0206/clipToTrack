import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import ClipCard from '../../components/ClipCard/ClipCard';
import { ProjectsModal } from '../../components/ProjectsModal/ProjectsModal';
import type { Clip } from '../../types';

const clip: Clip = {
  id: 'clip-1',
  index: 2,
  title: 'Orange Route',
  date: 'Oct 6, 2026',
  color: '#FF7A1A',
  duration: '1:23',
  distance: '4.2 km',
  maxSpeed: '42 km/h',
  altitude: '80 m',
  camera: 'HERO13 Black',
  gpsQuality: '3D fix · 2 pts',
  coordinates: [
    [-6.26, 53.34],
    [-6.27, 53.35],
  ],
  samples: [
    { lat: 53.34, lon: -6.26 },
    { lat: 53.35, lon: -6.27 },
  ],
  addedAt: 1,
  sort: {},
};

describe('clip colour styling', () => {
  it('sets clip colour variables on sidebar clip cards', () => {
    const html = renderToStaticMarkup(
      React.createElement(ClipCard, {
        clip,
        selected: false,
        playing: false,
        onSelect: () => {},
        onHover: () => {},
        onTogglePlay: () => {},
        onStop: () => {},
        onMaximize: () => {},
        hidden: false,
        onToggleHidden: () => {},
        onProgress: () => {},
        onDelete: () => {},
      }),
    );

    expect(html).toContain('--clip-color:#FF7A1A');
  });

  it('sets clip colour variables on project clip rows and thumbnails', () => {
    const html = renderToStaticMarkup(
      React.createElement(ProjectsModal, {
        views: [
          {
            id: 'project-1',
            name: 'Project',
            range: 'Oct 6, 2026',
            clipIds: [clip.id],
            custom: false,
            days: 1,
            distanceM: 4200,
          },
        ],
        clips: [clip],
        initialId: 'project-1',
        onRename: () => {},
        onMove: () => {},
        onOpen: () => {},
        onCreate: () => 'project-2',
        onDelete: () => {},
        onClose: () => {},
        onUpload: async () => {},
        busy: false,
        progress: null,
      }),
    );

    expect(html).toContain('--clip-color:#FF7A1A');
  });
});
