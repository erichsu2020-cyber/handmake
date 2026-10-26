import "server-only";
import { put } from "@vercel/blob";
import { writeBambu3mf } from "@/lib/bambu-3mf";
import type { BambuSettings } from "@/lib/bambu-settings";

// 網站上的模型和從電腦上傳的模型共用：下載 3MF → 寫入 Bambu 設定 → 另存到 Blob

// 帶 HTTP 狀態碼的錯誤，API 直接把訊息回給使用者
export class BambuFileError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function createBambuFile(modelFileUrl: string, settings: BambuSettings) {
  let input: Buffer;
  try {
    const res = await fetch(modelFileUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`下載 3MF 失敗 (${res.status})`);
    input = Buffer.from(await res.arrayBuffer());
  } catch (error) {
    console.error("下載 3MF 失敗", error);
    throw new BambuFileError("讀取 3MF 檔失敗", 502);
  }

  let output: Buffer;
  try {
    output = await writeBambu3mf(input, settings);
  } catch (error) {
    // 模型放不進平台等原因，訊息直接給使用者看
    console.error("寫入 Bambu 設定失敗", error);
    throw new BambuFileError(error instanceof Error ? error.message : "寫入 Bambu 設定失敗", 400);
  }

  let blob: Awaited<ReturnType<typeof put>>;
  try {
    blob = await put("handmake/models/bambu/model.3mf", output, {
      access: "public",
      contentType: "model/3mf",
      addRandomSuffix: true,
    });
  } catch (error) {
    console.error("上傳 Bambu 3MF 到 Vercel Blob 失敗", error);
    throw new BambuFileError("上傳 Vercel Blob 失敗", 500);
  }

  // 存進資料庫的 bambu 欄位（src/models/bambu-schema.ts）
  return {
    settings,
    sourceFileUrl: modelFileUrl,
    fileUrl: blob.url,
    filePathname: blob.pathname,
    fileSizeBytes: output.length,
    updatedAt: new Date(),
  };
}
