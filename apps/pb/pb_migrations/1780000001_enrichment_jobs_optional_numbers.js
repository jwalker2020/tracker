/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("enrichment_jobs");
  for (const name of ["totalPoints", "processedPoints", "nextPointIndex"]) {
    const field = collection.fields.getByName(name);
    if (field) field.required = false;
  }
  return app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId("enrichment_jobs");
  for (const name of ["totalPoints", "processedPoints", "nextPointIndex"]) {
    const field = collection.fields.getByName(name);
    if (field) field.required = true;
  }
  return app.save(collection);
});
