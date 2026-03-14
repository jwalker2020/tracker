/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "enrichment_artifacts",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        { name: "recordId", type: "text", required: true },
        { name: "userId", type: "text", required: false },
        { name: "file", type: "file", required: true, maxSelect: 1, maxSize: 1073741824 },
        { name: "size", type: "number", required: false },
      ],
    });
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("enrichment_artifacts");
    if (collection) app.delete(collection);
  }
);
