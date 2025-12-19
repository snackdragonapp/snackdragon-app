// next.config.ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
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