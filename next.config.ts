import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: true,
  // These are created at runtime (in /tmp on Vercel), not build dependencies.
  outputFileTracingExcludes: {
    "/*": [
      "./public/uploads/**/*",
      "./public/generated/**/*",
      "./data/heavy-jobs/**/*",
      "./data/projects.json",
      "./workers/**/*",
      "./tools/**/*",
      "./.codex-pulsereel-rollback*/**/*",
      "./.codex-pulsereel-rollback*.zip",
    ],
  },
};

export default nextConfig;
