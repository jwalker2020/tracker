# Stage 1: Backfill / migration notes for ownership fields

**Assumption:** Database is empty at Stage 1 completion; no legacy records.

- **gpx_files:** New records get `user` set by the server on upload. No backfill needed.
- **enrichment_jobs:** New jobs get `userId` set when enrichment starts. No backfill needed.

If you later import or migrate existing data: set `user` on `gpx_files` and optionally `userId` on `enrichment_jobs` so list/progress ownership is correct. Records with null `user` are excluded from the file list.
