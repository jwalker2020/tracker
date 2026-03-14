/// <reference path="../pb_data/types.d.ts" />
// Allow server-side (worker, API routes) to create/update/list/view enrichment_artifacts
// without authenticating as admin. Empty string = anyone (guests, auth users, admins).
// PocketBase must remain internal-only; do not expose its API to the public internet.
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("enrichment_artifacts");
    if (!collection) return;
    collection.listRule = "";
    collection.viewRule = "";
    collection.createRule = "";
    collection.updateRule = "";
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("enrichment_artifacts");
    if (!collection) return;
    collection.listRule = "";
    collection.viewRule = "";
    collection.createRule = "";
    collection.updateRule = "";
    app.save(collection);
  }
);
