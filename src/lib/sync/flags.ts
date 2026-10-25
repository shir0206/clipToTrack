/**
 * Is cloud sync actually running? Until Phases 3 and 4 land this is false, and the account UI is honest about it:
 * signing in does not move any data yet, so signing out must NOT wipe this device (nothing is in the cloud to
 * come back from). Phase 3/4 flips this to true (or derives it from the sync engine's state).
 */
export const CLOUD_SYNC_ACTIVE = false;
