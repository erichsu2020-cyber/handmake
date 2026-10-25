import { del, list } from "@vercel/blob";
import { connectDB } from "@/lib/mongodb";
import { DesignImage } from "@/models/DesignImage";
import { Generation } from "@/models/Generation";

// 找出 Vercel Blob 上沒有任何紀錄在用的檔案（例如重新轉檔前的舊版本、測試留下的檔案）

const PREFIX = "handmake/";
// 剛上傳的檔案可能還沒寫進資料庫（處理到一半），一小時內的都先不動
const GRACE_MS = 60 * 60 * 1000;

type GenerationUrls = {
  inputImageUrl?: string;
  outputImageUrl?: string;
  // stlUrl 是最早期資料的欄位
  model3d?: { fileUrl?: string; rawFileUrl?: string; stlUrl?: string };
};
type DesignUrls = { referenceImageUrl?: string; images?: { url: string }[] };

const pathOf = (url: string) => decodeURIComponent(new URL(url).pathname.slice(1));

async function referencedPaths() {
  await connectDB();
  const [generations, designs] = await Promise.all([
    Generation.find(
      {},
      {
        inputImageUrl: 1,
        outputImageUrl: 1,
        "model3d.fileUrl": 1,
        "model3d.rawFileUrl": 1,
        "model3d.stlUrl": 1,
      },
    ).lean<GenerationUrls[]>(),
    DesignImage.find({}, { referenceImageUrl: 1, "images.url": 1 }).lean<DesignUrls[]>(),
  ]);

  const urls: (string | null | undefined)[] = [];
  for (const g of generations) {
    const m = g.model3d;
    urls.push(g.inputImageUrl, g.outputImageUrl, m?.fileUrl, m?.rawFileUrl, m?.stlUrl);
  }
  for (const d of designs) {
    urls.push(d.referenceImageUrl, ...(d.images ?? []).map((image) => image.url));
  }
  return new Set(urls.filter((url): url is string => Boolean(url)).map(pathOf));
}

export type Orphan = { url: string; pathname: string; size: number; uploadedAt: string };

export async function findOrphans() {
  const used = await referencedPaths();
  const cutoff = Date.now() - GRACE_MS;
  const orphans: Orphan[] = [];
  let totalFiles = 0;
  let totalBytes = 0;

  let cursor: string | undefined;
  do {
    const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
    for (const blob of page.blobs) {
      totalFiles++;
      totalBytes += blob.size;
      if (used.has(blob.pathname) || new Date(blob.uploadedAt).getTime() > cutoff) continue;
      orphans.push({
        url: blob.url,
        pathname: blob.pathname,
        size: blob.size,
        uploadedAt: new Date(blob.uploadedAt).toISOString(),
      });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  return {
    totalFiles,
    totalBytes,
    orphans,
    orphanBytes: orphans.reduce((sum, o) => sum + o.size, 0),
  };
}

export async function deleteOrphans() {
  // 刪除前重新計算一次，避免預覽之後又有新紀錄用到某些檔案
  const { orphans, orphanBytes } = await findOrphans();
  for (let i = 0; i < orphans.length; i += 100) {
    await del(orphans.slice(i, i + 100).map((o) => o.url));
  }
  return { deletedFiles: orphans.length, deletedBytes: orphanBytes };
}

// 刪除一批檔案；失敗只記錄，不影響主要流程（之後也能用清理功能補刪）
export async function deleteBlobs(urls: (string | null | undefined)[]) {
  const targets = urls.filter((url): url is string => Boolean(url));
  if (targets.length === 0) return;
  try {
    await del(targets);
  } catch (error) {
    console.error("刪除 Vercel Blob 檔案失敗", error);
  }
}
