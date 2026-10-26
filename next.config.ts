import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  // 開發模式預設只讓 localhost 讀取開發用資源（即時更新、動態載入的程式）；
  // 用區網 IP（例如手機測試）打開時要列在這裡，不然畫畫版等動態載入的元件會載不出來。只影響 npm run dev
  allowedDevOrigins: ["192.168.1.117"],
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
