/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("gpx_files");
    if (!collection) return;
    if (collection.fields.getByName("enrichmentArtifactIndex")) return;
    collection.fields.add(
      new TextField({
        name: "enrichmentArtifactIndex",
        required: false,
        max: 1_000_000,
      })
    );
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("gpx_files");
    if (!collection) return;
    const field = collection.fields.getByName("enrichmentArtifactIndex");
    if (field) collection.fields.remove(field);
    app.save(collection);
  }
);
