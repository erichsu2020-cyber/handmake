import { isValidObjectId } from "mongoose";
import { getCurrentUser, unauthorized } from "@/lib/auth";
import { deleteBlobs } from "@/lib/blob-cleanup";
import { modelEditOwnedUrls } from "@/lib/model-edits";
import { connectDB } from "@/lib/mongodb";
import { ModelEdit } from "@/models/ModelEdit";

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
