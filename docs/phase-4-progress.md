# Phase 4 Progress

Phase 4 adds `buildRouteAnalysis`, a reusable route pipeline that keeps decoded GPS points immutable, validates coordinate and timestamp quality, filters by configurable GPS fix and DOP thresholds, rejects duplicate timestamps and impossible jumps, and records every rejection reason.

Accepted routes now produce WGS84 geodesic distance, duration, moving time, average speed, maximum speed, ascent, and descent. Optional time-aware smoothing is available but disabled by default, so raw and accepted routes remain unchanged unless a caller explicitly requests the processed route.

The MP4 parser now returns route analysis beside decoded telemetry. The reference LRV route yields 65 accepted points, a 6.4 second GPS span, approximately 46.84 metres by WGS84 geodesic distance, and a maximum 2D speed of approximately 38.25 km/h.

Tests cover no fix, missing fix, poor DOP, invalid coordinates, non-finite timestamps, duplicate timestamps, impossible jumps, stationary jitter, dateline smoothing, time gaps, smoothing immutability, parser integration, and the supplied HERO13 fixture.
