import type { NextConfig } from "next";

// `cacheComponents` stays off, and with it `partialPrefetching`, which only works on top of it: on the Workers runtime
// two concurrent renders hang the Worker and keep the isolate wedged for every later request (vercel/next.js#94880,
// opennextjs/opennextjs-cloudflare#1225; the adapter's fix is #1318). Turn both back on once a released
// @opennextjs/cloudflare carries that fix and concurrent loads of `/` all complete.
const nextConfig: NextConfig = {
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

// Exposes the Cloudflare bindings to `next dev`.
import("@opennextjs/cloudflare").then((m) => m.initOpenNextCloudflareForDev());
