import { getCurrentUser, unauthorized } from "@/lib/auth";
import { BambuFileError } from "@/lib/bambu-file";
import { importUploadedModel } from "@/lib/bambu-uploads";
import { deleteBlobs } from "@/lib/blob-cleanup";
import { toBambuUploadView } from "@/lib/generation-view";
import { connectDB } from "@/lib/mongodb";
import { BambuUpload } from "@/models/BambuUpload";

// 從電腦上傳的模型：瀏覽器先直接上傳到 Blob，再把網址和檔名送來這裡建立紀錄
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body = (await request.json().catch(() => null)) as { url?: unknown; name?: unknown } | null;
  if (typeof body?.url !== "string" || typeof body.name !== "string") {
    return Response.json({ error: "請求格式不正確" }, { status: 400 });
  }

  let fields: Awaited<ReturnType<typeof importUploadedModel>>;
  try {
    fields = await importUploadedModel(body.url, body.name);
  } catch (error) {
    if (error instanceof BambuFileError) return Response.json({ error: error.message }, { status: error.status });
    console.error("匯入上傳的模型失敗", error);
    return Response.json({ error: "匯入模型失敗" }, { status: 500 });
  }

  try {
    await connectDB();
    const doc = await BambuUpload.create({ userId: user.id, ...fields });
    return Response.json({ upload: toBambuUploadView(doc.toObject()) });
  } catch (error) {
    console.error("寫入 MongoDB 失敗", error);
    await deleteBlobs([fields.modelFileUrl]);
    return Response.json({ error: "模型已上傳，但寫入資料庫失敗" }, { status: 500 });
  }
}
