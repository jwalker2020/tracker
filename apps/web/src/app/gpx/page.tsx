import { redirect } from "next/navigation";

/**
 * Legacy route: GPX app moved to /. Redirect /gpx -> / so bookmarks and links still work.
 */
export default function GpxRedirectPage() {
  redirect("/");
}
