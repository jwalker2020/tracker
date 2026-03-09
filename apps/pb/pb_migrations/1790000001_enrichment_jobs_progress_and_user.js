/// <reference path="../pb_data/types.d.ts" />
// Add userId and progress-display fields to enrichment_jobs for shared persistent progress.
// Indexes on jobId and recordId for progress API and cancel/record lookup.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("enrichment_jobs");
    if (!collection) return;

    const toAdd = [
      { type: "text", name: "userId", required: false },
      { type: "number", name: "overallPercentComplete", required: false },
      { type: "text", name: "currentPhase", required: false },
      { type: "number", name: "currentPhasePercent", required: false },
      { type: "text", name: "error", required: false },
      { type: "number", name: "currentTrackIndex", required: false },
      { type: "number", name: "totalTracks", required: false },
    ];

    for (const f of toAdd) {
      if (collection.fields.getByName(f.name)) continue;
      if (f.type === "number") {
        collection.fields.add(new NumberField({ name: f.name, required: f.required }));
      } else {
        collection.fields.add(new TextField({ name: f.name, required: f.required }));
      }
    }

    // Indexes for jobId (progress API) and recordId (cancel / getCheckpointByRecordId)
    const indexes = collection.indexes || [];
    if (!indexes.some((s) => s.includes("idx_enrichment_jobs_jobId"))) {
      indexes.push("CREATE UNIQUE INDEX idx_enrichment_jobs_jobId ON enrichment_jobs (jobId)");
    }
    if (!indexes.some((s) => s.includes("idx_enrichment_jobs_recordId"))) {
      indexes.push("CREATE INDEX idx_enrichment_jobs_recordId ON enrichment_jobs (recordId)");
    }
    collection.indexes = indexes;

    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("enrichment_jobs");
    if (!collection) return;

    for (const name of [
      "userId",
      "overallPercentComplete",
      "currentPhase",
      "currentPhasePercent",
      "error",
      "currentTrackIndex",
      "totalTracks",
    ]) {
      const field = collection.fields.getByName(name);
      if (field) collection.fields.remove(field);
    }

    collection.indexes = (collection.indexes || []).filter(
      (s) => !s.includes("idx_enrichment_jobs_jobId") && !s.includes("idx_enrichment_jobs_recordId")
    );
    app.save(collection);
  }
);
