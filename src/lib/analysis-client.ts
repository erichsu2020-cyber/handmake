"use client";

import { useEffect, useState } from "react";
import { upload } from "@vercel/blob/client";

// 「AI 列印檢查」「成品改良」表單共用的小工具

// 檔案直接從瀏覽器上傳到 Vercel Blob，不經過伺服器（Vercel 函式的請求上限只有 4.5MB）
export const uploadToBlob = (path: string, body: Blob, contentType: string) =>
  upload(path, body, { access: "public", handleUploadUrl: "/api/blob-upload", contentType }).then((b) => b.url);

// AI 分析要 1–3 分鐘：active 期間每秒 +1，讓使用者知道還在跑
export function useElapsedSeconds(active: boolean) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 開始時歸零
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return elapsed;
}

// 照片縮到長邊 maxEdge 再轉成 JPEG：上傳快、AI 費用低；手機照片的方向（EXIF）會先轉正
export async function resizePhoto(file: File, maxEdge: number): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(`無法讀取「${file.name}」，請改用 JPEG 或 PNG（例如 iPhone 的 HEIC 要先轉檔）`);
  }
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("照片處理失敗"))), "image/jpeg", 0.88),
  );
}

// API 回應讀不到 JSON（例如逾時被平台中斷）時給使用者看得懂的訊息
export const readJson = (res: Response) =>
  res.json().catch(() => ({ error: `伺服器沒有回應 (${res.status})，可能是分析太久被中斷，請再試一次` }));
