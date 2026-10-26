import "server-only";
import { put } from "@vercel/blob";
import { BambuFileError } from "@/lib/bambu-file";
import { BAMBU_UPLOAD_FOLDER, MAX_BAMBU_UPLOAD_BYTES } from "@/lib/bambu-settings";
import { deleteBlobs } from "@/lib/blob-cleanup";
import { toBambuUploadView } from "@/lib/generation-view";
import { boundsSize, meshBounds, parseModel, writeModel } from "@/lib/mesh";
import { connectDB } from "@/lib/mongodb";
import { ownBlobUrl } from "@/lib/own-blob";
import { BambuUpload } from "@/models/BambuUpload";

// Bambu 設定頁「從電腦上傳」：瀏覽器已經把檔案傳到 Blob（見 /api/blob-upload），這裡把它整理成簡單的 3MF

const MAX_NAME_LENGTH = 200;

// 讀取上傳的 STL／3MF → 存成整理過的 3MF → 刪掉原始上傳檔。回傳要存進資料庫的欄位
export async function importUploadedModel(rawUrl: string, rawName: string) {
  const url = ownBlobUrl(rawUrl, BAMBU_UPLOAD_FOLDER);
  if (!url) throw new BambuFileError("檔案網址不正確", 400);
  const name = rawName.trim().slice(0, MAX_NAME_LENGTH) || "未命名模型";

  try {
    // 副檔名決定格式；Blob 加的隨機後綴在副檔名前面，所以看網址結尾就好
    const ext = url.pathname.toLowerCase().split(".").pop();
    const format: "STL" | "3MF" | null = ext === "stl" ? "STL" : ext === "3mf" ? "3MF" : null;
    if (!format) throw new BambuFileError("只支援 STL 和 3MF 檔", 400);

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new BambuFileError(`讀取上傳的檔案失敗 (${res.status})`, 502);
    const input = Buffer.from(await res.arrayBuffer());
    if (input.length > MAX_BAMBU_UPLOAD_BYTES) throw new BambuFileError("檔案不能超過 50MB", 400);

    let meshes;
    try {
      meshes = parseModel(format, input).filter((m) => m.indices.length > 0);
    } catch (error) {
      console.error("解析上傳的模型失敗", error);
      throw new BambuFileError(`讀不懂這個 ${format} 檔：${error instanceof Error ? error.message : "格式不正確"}`, 400);
    }
    if (meshes.length === 0) throw new BambuFileError("檔案裡沒有模型資料", 400);
    const size = boundsSize(meshBounds(meshes));
    if (size.some((v) => !(v > 0))) throw new BambuFileError("模型尺寸為 0", 400);

    const blob = await put("handmake/bambu/models/model.3mf", writeModel("3MF", meshes), {
      access: "public",
      contentType: "model/3mf",
      addRandomSuffix: true,
    });
    const round = (v: number) => Math.round(v * 10) / 10;
    return {
      name,
      sourceFormat: format,
      modelFileUrl: blob.url,
      modelFilePathname: blob.pathname,
      dimensionsMm: size.map(round),
      triangles: meshes.reduce((sum, m) => sum + m.indices.length / 3, 0),
      pieces: meshes.length,
    };
  } finally {
    // 不管成功或失敗，原始上傳檔都用不到了
    await deleteBlobs([url.href]);
  }
}

// 一律帶 userId：只查得到該帳號自己的紀錄
export async function listBambuUploads(userId: string, limit = 50) {
  await connectDB();
  const docs = await BambuUpload.find({ userId }).sort({ createdAt: -1 }).limit(limit).lean();
  return docs.map(toBambuUploadView);
}
