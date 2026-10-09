import { useEffect, useRef, useState } from 'react';
import { loadOpts } from '../MapPanel/MapPanel';
import Icon from '../Icon/Icon';
import { setProjectMode, useProjectMode } from '../../hooks/useProjects';
import {
  setSatelliteDefault,
  useSatelliteDefault,
} from '../../config/mapDefault';
import {
  setAllView,
  setView,
  useSettings,
  type ViewSettings,
} from '../../lib/settings';
import './Settings.css';

type Props = {
  onClose: () => void;
  clipCount: number;
  /** true when panel width / dock height are already at their defaults */
  layoutIsDefault: boolean;
  onResetLayout: () => void;
  onClearClips: () => void;
  /** the example project is in the library (or being added) */
  exampleOn: boolean;
  exampleBusy: boolean;
  onExampleChange: (on: boolean) => void;
  /** mobile layouts: panel sizes do not exist, so the Layout section is left out */
  hideLayout?: boolean;
};

const VIEW_ITEMS: [keyof ViewSettings, string, string][] = [
  ['search', 'Place search', 'Search box at the left of the map toolbar'],
  ['mapStyle', 'Map style', 'Basemap, colour-by and points menus'],
  [
    'layers',
    'Layer toggles',
    'Start/end, arrows, relief, focus, follow playhead, elevation profile',
  ],
  ['tools', 'Map tools', 'Measure, fit, fullscreen and export'],
  [
    'legend',
    'Colour legend',
    'Scale shown when colouring by speed or altitude',
  ],
  ['coords', 'Coordinates', 'Lat / lon readout in the map corner'],
  ['zoom', 'Zoom & compass', 'Zoom in / out buttons and the compass'],
  ['gps', 'My location (GPS)', 'Button that shows where you are'],
  ['terrain', '3D terrain', 'Button that tilts the map into 3D relief'],
  ['scale', 'Scale bar', 'Distance scale in the map corner'],
];

export default function Settings({
  onClose,
  clipCount,
  layoutIsDefault,
  onResetLayout,
  onClearClips,
  exampleOn,
  exampleBusy,
  onExampleChange,
  hideLayout = false,
}: Props) {
  const { view } = useSettings();
  const projectMode = useProjectMode();
  const satellite = useSatelliteDefault();
  const [confirmClear, setConfirmClear] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // the dialog mounts fresh each time it opens, so this is the current map colour mode
  const [colorMode] = useState(() => loadOpts().color);
  const allOn = VIEW_ITEMS.every(([k]) => view[k]);
  const allOff = VIEW_ITEMS.every(([k]) => !view[k]);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    box.current?.querySelector<HTMLElement>('input,button')?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('keydown', key);
      prev?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="settings-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={box}
        className="settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div className="settings-header">
          <h2 className="settings-heading">Settings</h2>
          <button
            className="icon-button"
            aria-label="Close settings"
            onClick={onClose}
          >
            <Icon name="close" size={14} />
          </button>
        </div>

        <section className="settings-section" aria-labelledby="set-projects">
          <h3 className="settings-title" id="set-projects">
            Projects
          </h3>
          <label className="settings-row">
            <span>
              <b className="settings-label">Group clips into projects</b>
              <small className="settings-hint">
                {projectMode
                  ? 'Clips are grouped into trips by date and place'
                  : 'Showing a plain list of clips. Your projects are kept and come back when you turn this on'}
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="toggle-switch"
              checked={projectMode}
              onChange={(e) => setProjectMode(e.target.checked)}
            />
          </label>
          <label className={`settings-row${exampleBusy ? ' is-disabled' : ''}`}>
            <span>
              <b className="settings-label">Example project</b>
              <small className="settings-hint">
                {exampleBusy
                  ? 'Adding the example clips…'
                  : exampleOn
                    ? 'A sample project in Tyrol, Austria. It comes back on every visit, even if you delete it. Turn off to remove it for good'
                    : 'Adds a sample project with a few short clips'}
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="toggle-switch"
              disabled={exampleBusy}
              checked={exampleOn}
              onChange={(e) => onExampleChange(e.target.checked)}
            />
          </label>
        </section>

        <section
          className="settings-section has-divider"
          aria-labelledby="set-map"
        >
          <h3 className="settings-title" id="set-map">
            Map
          </h3>
          <label className="settings-row">
            <span>
              <b className="settings-label">Satellite map by default</b>
              <small className="settings-hint">
                {satellite
                  ? 'The map opens as satellite imagery'
                  : 'The map opens as the street map'}
              </small>
              <small className="settings-hint">
                Map credits: © OpenStreetMap contributors · © OpenTopoMap
                (CC-BY-SA) · Tiles © Esri, Maxar, Earthstar Geographics ·
                Terrain: Mapzen / AWS Open Data
              </small>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="toggle-switch"
              checked={satellite}
              onChange={(e) => setSatelliteDefault(e.target.checked)}
            />
          </label>
        </section>

        <details
          className="settings-section settings-disclosure has-divider"
          role="group"
          aria-labelledby="set-view"
        >
          <summary className="settings-summary">
            <span>
              <span className="settings-title" id="set-view">
                View and map toolbars
              </span>
              <small className="settings-hint">
                Search, map style, layers, tools, coordinates, GPS, terrain, and
                scale controls
              </small>
            </span>
            <Icon name="chevron" size={14} className="chevron-icon" />
          </summary>
          {VIEW_ITEMS.map(([k, label, hint]) => {
            // the legend only exists while the map is coloured by speed / altitude
            const off = k === 'legend' && colorMode === 'route';
            return (
              <label
                key={k}
                className={`settings-row${off ? ' is-disabled' : ''}`}
              >
                <span>
                  <b className="settings-label">{label}</b>
                  <small className="settings-hint">
                    {off ? 'Not in use: map is coloured by route colour' : hint}
                  </small>
                </span>
                <input
                  type="checkbox"
                  role="switch"
                  className="toggle-switch"
                  disabled={off}
                  checked={view[k]}
                  onChange={(e) => setView({ [k]: e.target.checked })}
                />
              </label>
            );
          })}
          <div className="settings-footer">
            <button
              className="link-button"
              disabled={allOff}
              onClick={() => setAllView(false)}
            >
              Hide all
            </button>
            <button
              className="link-button"
              disabled={allOn}
              onClick={() => setAllView(true)}
            >
              Show all
            </button>
          </div>
        </details>

        {!hideLayout && (
          <section
            className="settings-section has-divider"
            aria-labelledby="set-layout"
          >
            <h3 className="settings-title" id="set-layout">
              Layout
            </h3>
            <div
              className={`settings-row${layoutIsDefault ? ' is-disabled' : ''}`}
            >
              <span>
                <b className="settings-label">Reset panel sizes</b>
                <small className="settings-hint">
                  {layoutIsDefault
                    ? 'Already at the default sizes'
                    : 'Clip list width and elevation dock height'}
                </small>
              </span>
              <button
                className="link-button"
                disabled={layoutIsDefault}
                onClick={onResetLayout}
              >
                Reset
              </button>
            </div>
          </section>
        )}

        <section
          className="settings-section has-divider"
          aria-labelledby="set-data"
        >
          <h3 className="settings-title" id="set-data">
            Saved data
          </h3>
          <div className={`settings-row${clipCount ? '' : ' is-disabled'}`}>
            <span>
              <b className="settings-label">Remove all clips</b>
              <small className="settings-hint">
                {clipCount
                  ? `Deletes ${clipCount} clip${clipCount === 1 ? '' : 's'} from the map and from this browser`
                  : 'Nothing to remove'}
              </small>
              {clipCount > 0 && (
                <small className="settings-warning" role="note">
                  <Icon name="warning" size={14} />
                  One-way: once you confirm, it can’t be undone.
                </small>
              )}
            </span>
            {confirmClear ? (
              <span className="settings-actions">
                <button
                  className="danger-button"
                  autoFocus
                  onClick={() => {
                    onClearClips();
                    setConfirmClear(false);
                  }}
                >
                  Yes
                </button>
                <button
                  className="link-button"
                  onClick={() => setConfirmClear(false)}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                className="link-button"
                disabled={!clipCount}
                onClick={() => setConfirmClear(true)}
              >
                Remove…
              </button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
