# Phase 3 progress

Phase 3 adds a recursive GPMF KLV decoder and a versioned telemetry domain model. It decodes primitive and complex values, applies stream type, scale, unit, SI unit, orientation, and timestamp metadata, and categorizes GPS, motion, orientation, imaging, environment, and audio streams. Unknown keys retain their unpadded raw payload for the complete JSON export planned in Phase 6.

GPS9 records are normalized into latitude, longitude, altitude, 2D and 3D speed, days since 2000, seconds since midnight, DOP, fix, and absolute UTC time. A GPS5 adapter combines older coordinate records with GPSU, GPSP, and GPSF metadata.

The MP4 parser now returns decoded telemetry and a deterministic hash of the raw `gpmd` sample bytes through its existing typed worker result. The supplied MP4 and LRV fixtures have matching hashes and normalized readings. Each yields 65 GPS9 points from `2026-09-21T08:36:35.300Z` through `2026-09-21T08:36:41.700Z`, with fix 3 and DOP 1.37, plus the expected accelerometer and gyroscope volume.

Tests cover KLV padding and truncation, nested containers, primitive types, complex structures, scale arrays, GPS5 compatibility, unknown-key retention, and real MP4/LRV parity.

Workflow note: this directory has no Git metadata, so the requested phase was implemented and verified in place rather than in an isolated worktree or commits.
