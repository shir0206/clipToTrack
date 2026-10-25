/** App-owned keys that can be cleared after signing out of cloud sync. */
export const KEY_REGISTRY: Record<string, { scope: 'pref' | 'data' }> = {
  'clip-to-track:clips:v1': { scope: 'data' },
  'clip-to-track:projects:v1': { scope: 'data' },
  'clip-to-track:clip-places:v1': { scope: 'data' },
  'clip-to-track:settings:v1': { scope: 'pref' },
  'clip-to-track:satellite-default:v1': { scope: 'pref' },
  'clip-to-track:project-mode:v1': { scope: 'pref' },
  'clip-to-track:playback-help-dismissed': { scope: 'pref' },
  'clip-to-track:map-opts:v4': { scope: 'pref' },
  'clip-to-track:sort': { scope: 'pref' },
};
