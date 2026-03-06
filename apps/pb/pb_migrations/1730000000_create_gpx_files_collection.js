migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "gpx_files",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: "name", type: "text", required: true },
        { name: "file", type: "file", required: true, maxSelect: 1, maxSize: 52428800 },
        { name: "uploadedBy", type: "text", required: false },
        { name: "boundsJson", type: "text", required: true },
        { name: "centerLat", type: "number", required: true },
        { name: "centerLng", type: "number", required: true },
        { name: "trackCount", type: "number", required: true },
        { name: "pointCount", type: "number", required: true },
        { name: "color", type: "text", required: true },
      ],
    });
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("gpx_files");
    if (collection) app.delete(collection);
  }
);
