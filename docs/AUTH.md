# Auth (PocketBase)

The web app uses PocketBase for auth. Log in on the GPX page to upload, list, enrich, and delete files as that user.

## Create a user

1. Run PocketBase: `cd apps/pb && ./pocketbase serve`
2. Open the admin UI: http://localhost:8090/_/
3. Go to **Auth & Users** and create a user (email + password). The default users collection has an **email** field only (no username).
4. Turn on the **verified** checkbox for that user so login is allowed (if your auth collection requires verified users).

## Log in

1. Open the GPX Viewer (e.g. http://localhost:3000/gpx).
2. If you are not logged in, the login form is shown.
3. Enter the **email** and password of the PocketBase user and click **Sign in**.
4. The app stores the session in a cookie so list/upload/enrich/delete work as that user.
5. Use **Log out** (top right) to clear the session.

If login fails, the form shows a short message. Common causes: wrong email/password, or the user is not **verified** in Admin → Auth & Users (turn on the verified checkbox).

## Technical notes

- **Server:** Login is handled by `POST /api/auth/login`, which authenticates with PocketBase and sets the auth cookie via `Set-Cookie`. All API routes (list, upload, enrich, progress, cancel, delete) read the user from the request cookie via `getCurrentUserId(request)`.
- **Optional:** `GUEST_USER_ID` in env is only an optional dev fallback when no cookie is present; do not rely on it for normal use.
