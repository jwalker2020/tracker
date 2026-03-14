/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("gpx_files");
    if (!collection) return;
    if (collection.fields.getByName("enrichedTracksSummary")) return;
    collection.fields.add(
      new TextField({
        name: "enrichedTracksSummary",
        required: false,
        max: 5_000_000,
      })
    );
    if (collection.fields.getByName("hasEnrichmentArtifact")) return;
    collection.fields.add(
      new BoolField({
        name: "hasEnrichmentArtifact",
        required: false,
      })
    );
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("gpx_files");
    if (!collection) return;
    for (const name of ["enrichedTracksSummary", "hasEnrichmentArtifact"]) {
      const field = collection.fields.getByName(name);
      if (field) collection.fields.remove(field);
    }
    app.save(collection);
  }
);
