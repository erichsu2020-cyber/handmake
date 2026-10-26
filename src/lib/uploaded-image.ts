import "server-only";
import { toFile } from "openai";
import { ownBlobUrl } from "@/lib/own-blob";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp"];

// 瀏覽器直接上傳到 Blob 後只會送網址過來：確認是自己 Blob 指定資料夾裡的圖片，再下載交給 OpenAI。
// 成功回傳 File，失敗回傳錯誤訊息
export async function fetchUploadedImage(rawUrl: string, folder: string) {
  const url = ownBlobUrl(rawUrl, folder);
  if (!url) return "圖片網址不正確";

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) return `讀取上傳的圖片失敗 (${res.status})`;
  const type = res.headers.get("content-type") ?? "";
  if (!ALLOWED_TYPES.includes(type)) return "只支援 PNG、JPEG、WebP 圖片";
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) return "圖片不能超過 20MB";

  return toFile(bytes, `upload.${type.split("/")[1]}`, { type });
}
