/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    const collection = new Collection({
      type: "base",
      name: "enrichment_jobs",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
      fields: [
        { name: "recordId", type: "text", required: true },
        { name: "jobId", type: "text", required: true },
        { name: "status", type: "text", required: true },
        { name: "totalPoints", type: "number", required: true },
        { name: "processedPoints", type: "number", required: true },
        { name: "nextPointIndex", type: "number", required: true },
        { name: "chunkSize", type: "number", required: true },
        { name: "startedAt", type: "date", required: true },
        { name: "updatedAt", type: "date", required: true },
        { name: "lastHeartbeatAt", type: "date", required: true },
        { name: "minElevationM", type: "number", required: false },
        { name: "maxElevationM", type: "number", required: false },
        { name: "totalAscentM", type: "number", required: false },
        { name: "totalDescentM", type: "number", required: false },
        { name: "distanceM", type: "number", required: false },
        { name: "priorElevationM", type: "number", required: false },
        { name: "validCount", type: "number", required: false },
        { name: "profileJson", type: "text", required: false },
        { name: "errorMessage", type: "text", required: false },
      ],
    });
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("enrichment_jobs");
    if (collection) app.delete(collection);
  }
);
