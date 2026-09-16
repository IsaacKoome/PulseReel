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
      // The hosted app delegates movie rendering to managed/remote providers.
      // Keep the local-only renderer and its native assets out of every Vercel
      // Function bundle; they remain installed and available for local runs.
      "./node_modules/ffmpeg-static/**/*",
      "./node_modules/@imgly/background-removal-node/**/*",
      "./.codex-pulsereel-rollback*/**/*",
      "./.codex-pulsereel-rollback*.zip",
    ],
  },
};

export default nextConfig;
