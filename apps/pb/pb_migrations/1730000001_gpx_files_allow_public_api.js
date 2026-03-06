// Allow public list/view/create so the app can upload and list GPX files without auth.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("gpx_files");
    if (!collection) return;
    collection.listRule = "";
    collection.viewRule = "";
    collection.createRule = "";
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("gpx_files");
    if (!collection) return;
    collection.listRule = null;
    collection.viewRule = null;
    collection.createRule = null;
    app.save(collection);
  }
);
