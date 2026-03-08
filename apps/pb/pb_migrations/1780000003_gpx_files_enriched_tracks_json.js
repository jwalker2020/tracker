// Add per-track enrichment storage: JSON array of EnrichedTrackSummary.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("gpx_files");
    if (!collection) return;
    if (collection.fields.getByName("enrichedTracksJson")) return;
    collection.fields.add(
      new TextField({
        name: "enrichedTracksJson",
        required: false,
        max: 10_000_000,
      })
    );
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("gpx_files");
    if (!collection) return;
    const field = collection.fields.getByName("enrichedTracksJson");
    if (field) collection.fields.remove(field);
    app.save(collection);
  }
);
