import "server-only";
import { isValidObjectId } from "mongoose";
import { DRAWING_FOLDER, DRAWING_SIZE, MAX_DRAWING_IMAGE_BYTES, type DrawingInput } from "@/lib/drawing-settings";
import { connectDB } from "@/lib/mongodb";
import { ownBlobUrl } from "@/lib/own-blob";
import { Drawing } from "@/models/Drawing";

// 頁面與 API 共用的畫作查詢和檢查

export type DrawingView = {
  id: string;
  title: string;
  width: number;
  height: number;
  layers: { name: string; visible: boolean; opacity: number; url: string }[];
  previewUrl: string;
  createdAt: string;
  updatedAt: string;
};

/* eslint-disable @typescript-eslint/no-explicit-any -- lean() 回來的文件型別不固定，在這裡統一轉換 */
export function toDrawingView(doc: any): DrawingView {
  return {
    id: doc._id.toString(),
    title: doc.title,
    width: doc.width,
    height: doc.height,
    layers: doc.layers.map((l: any) => ({ name: l.name, visible: l.visible, opacity: l.opacity, url: l.url })),
    previewUrl: doc.previewUrl,
    createdAt: new Date(doc.createdAt).toISOString(),
    updatedAt: new Date(doc.updatedAt).toISOString(),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// 一律帶 userId：只查得到該帳號自己的紀錄
export async function listDrawings(userId: string, limit = 100) {
  await connectDB();
  const docs = await Drawing.find({ userId }).sort({ updatedAt: -1 }).limit(limit).lean();
  return docs.map(toDrawingView);
}

export async function getDrawing(id: string, userId: string) {
  if (!isValidObjectId(id)) return null;
  await connectDB();
  const doc = await Drawing.findOne({ _id: id, userId }).lean();
  return doc ? toDrawingView(doc) : null;
}

// 確認每個網址都是自己 Blob 畫作資料夾裡、真的存在的 PNG，回傳要存進資料庫的欄位；有問題回傳錯誤訊息
export async function checkDrawingFiles(input: DrawingInput) {
  const urls = [input.previewUrl, ...input.layers.map((l) => l.url)];
  const checked = await Promise.all(
    urls.map(async (raw) => {
      const url = ownBlobUrl(raw, DRAWING_FOLDER);
      if (!url) return "圖片網址不正確";
      const res = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (!res.ok) return `找不到上傳的圖片 (${res.status})`;
      if (res.headers.get("content-type") !== "image/png") return "圖層只能是 PNG";
      if (Number(res.headers.get("content-length") ?? 0) > MAX_DRAWING_IMAGE_BYTES) return "圖片太大";
      return decodeURIComponent(url.pathname.slice(1));
    }),
  );
  const error = checked.find((c) => !c.startsWith(DRAWING_FOLDER));
  if (error) return error;

  const [previewPathname, ...layerPathnames] = checked;
  return {
    title: input.title,
    width: DRAWING_SIZE,
    height: DRAWING_SIZE,
    layers: input.layers.map((l, i) => ({ ...l, pathname: layerPathnames[i] })),
    previewUrl: input.previewUrl,
    previewPathname,
  };
}

// 畫作用到的所有檔案（刪除、更新時用）
export const drawingFileUrls = (d: { previewUrl?: string; layers?: { url: string }[] }) => [
  d.previewUrl,
  ...(d.layers ?? []).map((l) => l.url),
];
