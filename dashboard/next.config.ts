import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  env: {
    // Absolute path to the repo's sample-app, resolved at build time so the
    // "sample-app" trigger preset works from wherever the repo is checked out.
    NEXT_PUBLIC_SAMPLE_APP_PATH: path.join(process.cwd(), "..", "sample-app"),
  },
};

export default nextConfig;
