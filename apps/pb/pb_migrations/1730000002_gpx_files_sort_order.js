// Add sortOrder for persistent list order; allow public update so client can save order.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("gpx_files");
    if (!collection) return;
    collection.fields.add(new NumberField({
      name: "sortOrder",
      required: false,
    }));
    collection.updateRule = "";
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("gpx_files");
    if (!collection) return;
    const field = collection.fields.getByName("sortOrder");
    if (field) collection.fields.remove(field);
    collection.updateRule = null;
    app.save(collection);
  }
);
