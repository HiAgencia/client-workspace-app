import { defineCloudflareConfig } from "@opennextjs/cloudflare";
import staticAssetsIncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache";

// Prerendered routes are served read-only from the Worker's static assets: the app renders user data per request and
// never revalidates, so it needs no writable cache. The adapter's deploy command copies them into the assets.
export default defineCloudflareConfig({
  incrementalCache: staticAssetsIncrementalCache,
});
