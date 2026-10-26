import { isValidObjectId } from "mongoose";
import { getCurrentUser, unauthorized } from "@/lib/auth";
import { deleteBlobs } from "@/lib/blob-cleanup";
import { connectDB } from "@/lib/mongodb";
import { printCheckOwnedUrls } from "@/lib/print-checks";
import { PrintCheck } from "@/models/PrintCheck";

// 刪除一筆檢查紀錄，連同截圖、修正後的檔案；如果檢查的是這頁上傳的 3MF，也一起刪
export async function DELETE(_request: Request, ctx: RouteContext<"/api/print-checks/[id]">) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  if (!isValidObjectId(id)) return Response.json({ error: "找不到這筆紀錄" }, { status: 404 });

  await connectDB();
  const doc = await PrintCheck.findOne({ _id: id, userId: user.id }).lean();
  if (!doc) return Response.json({ error: "找不到這筆紀錄" }, { status: 404 });

  await deleteBlobs(printCheckOwnedUrls(doc));
  await PrintCheck.deleteOne({ _id: doc._id });
  return Response.json({ ok: true });
}
