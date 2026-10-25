import { getCurrentUser, unauthorized } from "@/lib/auth";
import { deleteOrphans, findOrphans } from "@/lib/blob-cleanup";

// GET：預覽有哪些沒用到的檔案；POST：實際刪除
export async function GET() {
  if (!(await getCurrentUser())) return unauthorized();
  try {
    const { totalFiles, totalBytes, orphans, orphanBytes } = await findOrphans();
    // 依資料夾分組，讓使用者知道是哪類檔案
    const byFolder: Record<string, { files: number; bytes: number }> = {};
    for (const o of orphans) {
      const folder = o.pathname.split("/").slice(0, -1).join("/");
      byFolder[folder] ??= { files: 0, bytes: 0 };
      byFolder[folder].files++;
      byFolder[folder].bytes += o.size;
    }
    return Response.json({ totalFiles, totalBytes, orphanFiles: orphans.length, orphanBytes, byFolder });
  } catch (error) {
    console.error("檢查 Vercel Blob 失敗", error);
    return Response.json({ error: "檢查儲存空間失敗" }, { status: 500 });
  }
}

export async function POST() {
  if (!(await getCurrentUser())) return unauthorized();
  try {
    return Response.json(await deleteOrphans());
  } catch (error) {
    console.error("清理 Vercel Blob 失敗", error);
    return Response.json({ error: "清理儲存空間失敗" }, { status: 500 });
  }
}
