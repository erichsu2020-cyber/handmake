import { isValidObjectId } from "mongoose";
import { getCurrentUser, unauthorized } from "@/lib/auth";
import { deleteBlobs } from "@/lib/blob-cleanup";
import { MODEL_EDIT_SNAPSHOT_FOLDER } from "@/lib/model-edit-settings";
import { modelEditOwnedUrls, saveResultSnapshots } from "@/lib/model-edits";
import { connectDB } from "@/lib/mongodb";
import { ownBlobUrl } from "@/lib/own-blob";
import { ModelEdit } from "@/models/ModelEdit";

// 存改好的模型截圖（瀏覽器第一次打開結果頁時拍好、上傳到 Blob 後送網址過來）
export async function PATCH(request: Request, ctx: RouteContext<"/api/model-edits/[id]">) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { resultSnapshotUrls?: unknown } | null;
  const urls = body?.resultSnapshotUrls;
  if (
    !Array.isArray(urls) ||
    urls.length === 0 ||
    urls.length > 5 ||
    !urls.every((u): u is string => typeof u === "string" && !!ownBlobUrl(u, MODEL_EDIT_SNAPSHOT_FOLDER))
  ) {
    return Response.json({ error: "截圖網址不正確" }, { status: 400 });
  }
  const saved = await saveResultSnapshots(id, user.id, urls);
  // 已經存過的話，這次上傳的截圖用不到，直接刪掉
  if (!saved) await deleteBlobs(urls);
  return Response.json({ saved });
}

// 刪除一筆修改紀錄，連同上傳的 3MF、截圖和改好的 3MF
export async function DELETE(_request: Request, ctx: RouteContext<"/api/model-edits/[id]">) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  if (!isValidObjectId(id)) return Response.json({ error: "找不到這筆紀錄" }, { status: 404 });

  await connectDB();
  const doc = await ModelEdit.findOne({ _id: id, userId: user.id }).lean();
  if (!doc) return Response.json({ error: "找不到這筆紀錄" }, { status: 404 });

  await deleteBlobs(modelEditOwnedUrls(doc));
  await ModelEdit.deleteOne({ _id: doc._id });
  return Response.json({ ok: true });
}
