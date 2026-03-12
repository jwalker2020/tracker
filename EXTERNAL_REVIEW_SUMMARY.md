# External Review Summary: Recent Changes

**Impact:** Enrichment now works with or without DEM (GPX-only mode when DEM is unset), GPX `<ele>` is used when present so DEM sampling is skipped where possible, and chart hover is simplified (vertical crosshair and floating label removed; tooltips kept). Async enrichment runs in a separate worker process; the web app only creates jobs and returns `jobId`. Documentation is aligned with the current worker-based architecture and reviewer needs.

---

## What Changed

**1. GPX elevation enrichment without DEM**  
Enrichment no longer requires DEM to be configured. When `DEM_BASE_PATH` is unset, the pipeline runs in a “GPX-only” mode: it uses track geometry (lat/lon) and any `<ele>` values from the GPX to compute distance, elevation stats, grade, curviness, and the elevation profile. When DEM is configured, points that already have valid GPX elevation skip DEM sampling; DEM is used only for points missing or invalid elevation. Duplicate consecutive points and zero-distance segments are handled so they do not break cumulative distance or cause divide-by-zero in stats or grade.

**Elevation source priority** (explicit order):

1. **GPX `<ele>`** — used when present and valid (finite number).
2. **DEM sampling** — used only when GPX elevation is missing or invalid, and DEM is configured and available for the point.
3. **Missing** — if neither source supplies a value, the point has no elevation (stats aggregate over valid points only).

**Parser behavior**  
The parser uses **local-name matching only when the standard lookup returns no result**: it first uses `getElementsByTagName("ele")` / `getElementsByTagName("name")`; if that returns no element (e.g. GPX 1.1 default namespace), it then looks for the first child with that local name. Non-namespaced and legacy GPX are unchanged.

**2. Chart hover and layout**  
On the elevation, curviness, and grade charts (ECharts), the **ECharts axis/crosshair-style vertical hover line** and the **custom floating metric label** were removed. **Tooltips remain:** the axis tooltip still appears when hovering over the chart. The grade chart (bottom of the stack) was given extra bottom grid padding and a small panel padding so it is no longer clipped.

**Performance**  
GPX-only enrichment avoids DEM tile loading and raster sampling. For tracks that already have elevation, enrichment is faster when DEM is not configured; when DEM is configured, points with valid GPX elevation skip DEM sampling, reducing I/O and compute.

**3. Enrichment architecture**  
Async enrichment runs only in a **separate worker process** (`pnpm run enrichment-worker`). The web app creates or locates the job and returns `jobId`; the worker polls for claimable jobs and runs **runEnrichmentJob**. Progress and cancel state are **PocketBase-backed**; the web app does not run or resume enrichment.

**4. Documentation**  
`PROJECT_CONTEXT.md`, `CURRENT_STATE.md`, and this summary are kept in sync with the worker-based architecture, elevation source priority, and reviewer clarity (purpose, stack, modules, API, enrichment pipeline, progress/cancel, chart–map, filtering, auth, deployment, limitations).

**5. Production deployment (current approved model)**  
- **Stack:** Docker Compose / Coolify with three services: **web** (public), **worker** (internal-only), **pocketbase** (internal-only). Same app image for web and worker; PocketBase is a separate image. Internal Docker network `tracker`; only web exposes port 3000.
- **Public access:** Cloudflare Tunnel points only at the web service (e.g. https://tracker.nhwalker.net → web). PocketBase and worker must never have a public hostname, tunnel, or exposed port.
- **Config:** `NEXT_PUBLIC_PB_URL=http://pocketbase:8090` for web and worker; browser does not call PocketBase directly (same-origin API). PocketBase data in named volume `pb_data` at `/app/pb_data`. Admin access to PocketBase via LAN or WireGuard only (SSH port-forward or LAN-restricted host port). See `docs/PRODUCTION_DEPLOYMENT.md` and `docs/deployment.md`.

---

## Files Changed

| Area | Files |
|------|--------|
| DEM / GPX pipeline | `apps/web/src/lib/dem/enrich-elevation.ts`, `apps/web/src/lib/dem/gpx-extract.ts` |
| Enrich API & worker | `apps/web/src/app/api/gpx/enrich/route.ts`, `apps/web/src/lib/enrichment/runEnrichmentJob.ts`, `apps/web/src/lib/enrichment/workerLoop.ts` |
| Charts | `apps/web/src/components/gpx/TrackElevationProfile.tsx`, `TrackCurvinessProfile.tsx`, `TrackGradeProfile.tsx`, `TrackProfilePanel.tsx` |
| Docs | `PROJECT_CONTEXT.md`, `CURRENT_STATE.md`, `EXTERNAL_REVIEW_SUMMARY.md` |

---

## Why the Change Was Made

Users uploaded GPX files with lat, lon, and elevation (e.g. Strava). Previously, enrichment was **skipped entirely** when `DEM_BASE_PATH` was unset, and when DEM was set the pipeline did not **prefer** GPX `<ele>` over DEM, so in-file elevation was sometimes overwritten or enrichment failed. Changes: (1) support **GPX-only enrichment** when DEM is unset; (2) use **GPX `<ele>` first**, DEM only for missing/invalid elevation when DEM is configured; (3) handle namespaced GPX 1.1 (local-name fallback when standard lookup fails) and **duplicate consecutive points** / **zero-distance segments** without errors. Chart changes remove the vertical crosshair and floating label to reduce clutter while keeping tooltips; grade chart padding fixes bottom clipping.

---

## Possible Regressions

- **No DEM, no GPX elevation**: If a file has no `<ele>` and DEM is not configured, enrichment still runs but all elevation samples are “missing”; the API may return a warning and not persist elevation stats. This is intended; the only change is that enrichment is no longer skipped entirely when DEM is unset.
- **Chart hover**: Removing the vertical crosshair line and floating metric label could affect anyone who relied on that exact visual; tooltip content and behavior are unchanged.
- **Duplicate points**: Duplicate consecutive points add zero distance and are accounted for in cumulative distance and stats. The change is that duplicates no longer cause errors. In edge cases, many duplicates could slightly affect smoothed or derived metrics (e.g. median-smoothed elevation, curviness) because the point count in the series is unchanged; accepted and not considered a functional regression.
- **Namespace fallback**: Local-name fallback is **additive** and used only when the standard lookup fails. It could in theory match an element from another namespace with the same local name; in practice GPX 1.1 track data uses a single namespace for `<ele>` and `<name>`, so risk is low.

---

## Testing Performed

Validated scenarios (consistent with the implemented changes):

- Strava-style GPX export / GPX 1.1 default namespace: `<ele>` and `<name>` read correctly.
- GPX with elevation, DEM not configured: full enrichment from GPX only (distance, elevation stats, profile, grade, curviness).
- GPX with elevation, DEM configured: GPX elevation used where present; DEM only for missing/invalid points.
- GPX without elevation, DEM configured: DEM sampling and enrichment as before.
- Duplicate consecutive points (same lat/lon or same lat/lon with different time): no crash; zero-length segments in distance; stats and grade/curviness safe.
- Zero-length segments: cumulative distance and derived metrics handle them without divide-by-zero.

---

## Backward Compatibility

- **enrichedTracksJson** is the primary per-track data shape; the pipeline writes it and the UI reads it. No schema change.
- **elevationProfileJson** (legacy) is unchanged and still supported for display when present; the app prefers enrichedTracksJson when available.

---

## Known Limitations

- GPX elevation is assumed to be in **meters** (per GPX 1.1); no detection or conversion for feet.
- **Worker-based enrichment**: Async jobs run only in the enrichment worker; the web app creates jobs and returns `jobId`. Progress and cancel are PocketBase-backed; partial file-level resume is not implemented.
- Very large tracks can produce large **enrichedTracksJson**; PocketBase storage and response limits may still apply.
- Progress and checkpoint writes are **best-effort**; failures are logged but do not stop enrichment.
- **Guest auth**: `GUEST_USER_ID` is dev-only; not for production.

---

## Future Improvements

- Deprecate or remove legacy **elevationProfileJson** once all consumers use **enrichedTracksJson**.
- Consolidate dual enrichment paths (`lib/gpx/enrich.ts` vs `lib/dem/enrich-elevation.ts`) or document which flows use which.
- Implement **partial resume** from checkpoint so the worker can resume from the last persisted checkpoint per track after a crash instead of restarting the full file.
- Large-track handling: downsampling or capping profile points for storage to avoid PocketBase limits.

---

## Safety Guarantees

- **GPX lat/lon is authoritative** for geometry; DEM affects **only elevation**, not coordinates.
- Elevation source order: GPX `<ele>` (when valid) → DEM (when configured and available) → missing.
