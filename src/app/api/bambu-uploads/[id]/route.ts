import { isValidObjectId } from "mongoose";
import { getCurrentUser, unauthorized } from "@/lib/auth";
import { deleteBlobs } from "@/lib/blob-cleanup";
import { connectDB } from "@/lib/mongodb";
import { BambuUpload } from "@/models/BambuUpload";

// 刪除一筆上傳的模型，連同 Blob 上的 3MF 和 Bambu 設定檔
export async function DELETE(_request: Request, ctx: RouteContext<"/api/bambu-uploads/[id]">) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  if (!isValidObjectId(id)) return Response.json({ error: "找不到這筆資料" }, { status: 404 });

  await connectDB();
  const doc = await BambuUpload.findOne({ _id: id, userId: user.id }).lean();
  if (!doc) return Response.json({ error: "找不到這筆資料" }, { status: 404 });

  await deleteBlobs([doc.modelFileUrl, doc.bambu?.fileUrl]);
  await BambuUpload.deleteOne({ _id: doc._id });
  return Response.json({ ok: true });
}
