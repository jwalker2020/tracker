// Raise performanceJson max length so validation doesn't fail (default 5000 can be tight).
const PERFORMANCE_JSON_MAX = 500_000;

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("gpx_files");
    if (!collection) return;
    const field = collection.fields.getByName("performanceJson");
    if (field) field.max = PERFORMANCE_JSON_MAX;
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("gpx_files");
    if (!collection) return;
    const field = collection.fields.getByName("performanceJson");
    if (field) field.max = 5000;
    app.save(collection);
  }
);
