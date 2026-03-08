// Add DEM enrichment result fields to gpx_files (stats + profile for charts).
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("gpx_files");
    if (!collection) return;

    const fields = [
      { type: "number", name: "distanceM", required: false },
      { type: "number", name: "minElevationM", required: false },
      { type: "number", name: "maxElevationM", required: false },
      { type: "number", name: "totalAscentM", required: false },
      { type: "number", name: "totalDescentM", required: false },
      { type: "number", name: "averageGradePct", required: false },
      { type: "text", name: "elevationProfileJson", required: false },
    ];

    for (const f of fields) {
      if (collection.fields.getByName(f.name)) continue;
      if (f.type === "number") {
        collection.fields.add(new NumberField({ name: f.name, required: f.required }));
      } else {
        collection.fields.add(new TextField({ name: f.name, required: f.required }));
      }
    }

    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("gpx_files");
    if (!collection) return;

    const names = [
      "distanceM",
      "minElevationM",
      "maxElevationM",
      "totalAscentM",
      "totalDescentM",
      "averageGradePct",
      "elevationProfileJson",
    ];
    for (const name of names) {
      const field = collection.fields.getByName(name);
      if (field) collection.fields.remove(field);
    }
    app.save(collection);
  }
);
