import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // manifold-3d 會在執行時載入自己的 .wasm 檔，不要打包，直接從 node_modules 讀取
  serverExternalPackages: ["manifold-3d"],
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
