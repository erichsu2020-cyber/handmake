import { isValidObjectId } from "mongoose";
import { getCurrentUser, unauthorized } from "@/lib/auth";
import { deleteBlobs } from "@/lib/blob-cleanup";
import { connectDB } from "@/lib/mongodb";
import { printReviewOwnedUrls } from "@/lib/print-reviews";
import { PrintReview } from "@/models/PrintReview";

// 刪除一筆改良紀錄，連同照片、模型截圖、修正後的檔案；如果用的是這頁上傳的 3MF，也一起刪
export async function DELETE(_request: Request, ctx: RouteContext<"/api/print-reviews/[id]">) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  if (!isValidObjectId(id)) return Response.json({ error: "找不到這筆紀錄" }, { status: 404 });

  await connectDB();
  const doc = await PrintReview.findOne({ _id: id, userId: user.id }).lean();
  if (!doc) return Response.json({ error: "找不到這筆紀錄" }, { status: 404 });

  await deleteBlobs(printReviewOwnedUrls(doc));
  await PrintReview.deleteOne({ _id: doc._id });
  return Response.json({ ok: true });
}
