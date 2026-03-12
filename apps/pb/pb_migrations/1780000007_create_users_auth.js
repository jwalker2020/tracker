// Auth collection for app login (pb.collection("users").authWithPassword).
// App users log in here; PocketBase Admins are for the dashboard only.
migrate(
  (app) => {
    if (app.findCollectionByNameOrId("users")) return;
    const collection = new Collection({
      type: "auth",
      name: "users",
      listRule: "",
      viewRule: "",
      createRule: "",
      updateRule: "",
      deleteRule: "",
    });
    app.save(collection);
  },
  (app) => {
    const collection = app.findCollectionByNameOrId("users");
    if (collection) app.delete(collection);
  }
);
