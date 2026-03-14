/// <reference path="../pb_data/types.d.ts" />
/**
 * Add unique index on enrichment_artifacts.recordId so only one artifact per gpx_files record exists.
 * If you have duplicate recordIds, dedupe (e.g. keep newest per recordId) before running.
 */
migrate(
  (app) => {
    app.db()
      .newQuery(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_enrichment_artifacts_record_id ON enrichment_artifacts (recordId)"
      )
      .execute();
  },
  (app) => {
    app.db()
      .newQuery("DROP INDEX IF EXISTS idx_enrichment_artifacts_record_id")
      .execute();
  }
);
