// next.config.ts
import type { NextConfig } from "next";
import { execSync } from "node:child_process";

// Short git hash of the commit being built, so a running deployment can be
// matched to a commit from the page itself (shown in the footer).
function buildSha(): string {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  env: {
    NEXT_PUBLIC_BUILD_SHA: buildSha(),
  },
  // ✅ Add this to generate .map files for production builds
  productionBrowserSourceMaps: false, 
  
  // Optional: If the error persists and remains cryptic, 
  // you can try disabling minification temporarily to debug:
  // webpack: (config, { dev }) => {
  //   if (!dev) {
  //     config.optimization.minimize = false;
  //   }
  //   return config;
  // },
};

export default nextConfig;