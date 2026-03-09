// Add user relation to gpx_files for multi-user ownership.
// Requires an auth collection named "users" to exist (create in PocketBase admin if needed).
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId("gpx_files");
    if (!collection) return;
    if (collection.fields.getByName("user")) return;

    const usersCollection = app.findCollectionByNameOrId("users");
    if (!usersCollection) {
      throw new Error(
        "Migration requires an auth collection named 'users'. Create it in the PocketBase admin (e.g. Auth & Users) first."
      );
    }

    collection.fields.add(
      new RelationField({
        name: "user",
        collectionId: usersCollection.id,
        required: false,
        maxSelect: 1,
      })
    );
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("gpx_files");
    if (!collection) return;
    const field = collection.fields.getByName("user");
    if (field) collection.fields.remove(field);
    app.save(collection);
  }
);
