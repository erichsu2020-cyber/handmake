import { getCurrentUser, unauthorized } from "@/lib/auth";
import { UserError } from "@/lib/bambu-source";
import { MODEL_EDIT_SNAPSHOT_FOLDER, MODEL_EDIT_UPLOAD_FOLDER, parseEditRequest } from "@/lib/model-edit-settings";
import { runModelEdit } from "@/lib/model-edits";
import { ownBlobUrl } from "@/lib/own-blob";

// AI 規劃約 1–2 分鐘，加上挖孔運算，預設的時間上限不夠
export const maxDuration = 300;

// 瀏覽器已經把 3MF 和截圖傳到 Blob，這裡只收網址和修改需求
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "缺少環境變數 OPENAI_API_KEY" }, { status: 500 });
  }

  const body = (await request.json().catch(() => null)) as {
    fileUrl?: unknown;
    name?: unknown;
    request?: unknown;
    snapshotUrls?: unknown;
  } | null;

  const edit = parseEditRequest(body?.request);
  if (typeof edit === "string") return Response.json({ error: edit }, { status: 400 });

  if (typeof body?.fileUrl !== "string" || !ownBlobUrl(body.fileUrl, MODEL_EDIT_UPLOAD_FOLDER)) {
    return Response.json({ error: "請先上傳 3MF 檔" }, { status: 400 });
  }
  const snapshotUrls = Array.isArray(body.snapshotUrls) ? body.snapshotUrls : [];
  if (snapshotUrls.length > 4 || !snapshotUrls.every((u): u is string => typeof u === "string" && !!ownBlobUrl(u, MODEL_EDIT_SNAPSHOT_FOLDER))) {
    return Response.json({ error: "截圖網址不正確" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "model.3mf";

  try {
    const result = await runModelEdit(body.fileUrl, name, edit, snapshotUrls);
    return Response.json({ result });
  } catch (error) {
    if (error instanceof UserError) return Response.json({ error: error.message }, { status: error.status });
    console.error("AI 改模型失敗", error);
    return Response.json({ error: "修改失敗，請再試一次" }, { status: 500 });
  }
}
