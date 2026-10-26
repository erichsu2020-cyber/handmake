"use client";

import dynamic from "next/dynamic";

// 畫畫版一開始就要建立 canvas，只能在瀏覽器執行
const DrawingEditorLazy = dynamic(() => import("@/components/DrawingEditor"), {
  ssr: false,
  loading: () => <p className="text-zinc-500">載入畫畫版…</p>,
});

export default DrawingEditorLazy;
