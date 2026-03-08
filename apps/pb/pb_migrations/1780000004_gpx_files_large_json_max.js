// Raise max length for JSON text fields so multi-track enrichment (enrichedTracksJson)
// and legacy elevationProfileJson can store large payloads. PocketBase default is 5000.
const LARGE_JSON_MAX = 10_000_000;

migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("gpx_files");
    if (!collection) return;

    for (const name of ["enrichedTracksJson", "elevationProfileJson"]) {
      const field = collection.fields.getByName(name);
      if (field) field.max = LARGE_JSON_MAX;
    }
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("gpx_files");
    if (!collection) return;

    for (const name of ["enrichedTracksJson", "elevationProfileJson"]) {
      const field = collection.fields.getByName(name);
      if (field) field.max = 5000; // revert to PocketBase default
    }
    app.save(collection);
  }
);
