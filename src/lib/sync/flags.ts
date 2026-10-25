/** Preferences (settings, map options, sort order…) sync to the signed-in account. Phase 3. */
export const PREFS_SYNC_ACTIVE = true;

/**
 * Clips and projects sync too. Phase 4 flips this. Until then it is false, and signing out must NOT wipe this
 * device: the clips are not in the cloud, so wiping would destroy the only copy. (Preferences alone are not a
 * reason to wipe: losing them costs nothing, but a person who signs out expects their clips to still be there.)
 */
export const CLOUD_SYNC_ACTIVE = false;
