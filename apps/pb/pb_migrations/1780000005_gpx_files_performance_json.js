// Add performanceJson to gpx_files: enhancement run timing and throughput metrics (JSON).
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("gpx_files");
    if (!collection) return;
    if (collection.fields.getByName("performanceJson")) return;
    collection.fields.add(
      new TextField({
        name: "performanceJson",
        required: false,
        max: 5000,
      })
    );
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("gpx_files");
    if (!collection) return;
    const field = collection.fields.getByName("performanceJson");
    if (field) collection.fields.remove(field);
    app.save(collection);
  }
);
