"use client";

import { useEffect, useState } from "react";

// 設計頁、建立頁網址帶 ?drawing=<畫作 id> 時，把畫作（合併後的預覽圖）讀成 File，當成參考圖／原圖
// 直接讀 window.location，不用 useSearchParams，頁面才不用多包一層 Suspense
export function useDrawingImport(onFile: (file: File) => void) {
  const [state, setState] = useState<{ status: "idle" | "loading" | "done" | "error"; title?: string; error?: string }>({
    status: "idle",
  });

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("drawing");
    if (!id) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 開始讀取時顯示「帶入中」
    setState({ status: "loading" });
    (async () => {
      const res = await fetch(`/api/drawings/${encodeURIComponent(id)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "讀取畫作失敗");
      const image = await fetch(data.drawing.previewUrl);
      if (!image.ok) throw new Error("讀取畫作圖片失敗");
      const title: string = data.drawing.title;
      if (cancelled) return;
      onFile(new File([await image.blob()], `${title}.png`, { type: "image/png" }));
      setState({ status: "done", title });
    })().catch((err) => {
      if (!cancelled) setState({ status: "error", error: err instanceof Error ? err.message : "讀取畫作失敗" });
    });
    return () => {
      cancelled = true;
    };
    // 只在打開頁面時讀一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return state;
}
