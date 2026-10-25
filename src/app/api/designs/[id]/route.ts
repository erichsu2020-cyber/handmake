import { isValidObjectId } from "mongoose";
import { deleteBlobs } from "@/lib/blob-cleanup";
import { getCurrentUser, unauthorized } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { DesignImage } from "@/models/DesignImage";

// 刪除一筆設計紀錄，連同 Vercel Blob 上的設計圖與參考圖
export async function DELETE(_request: Request, ctx: RouteContext<"/api/designs/[id]">) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  if (!isValidObjectId(id)) return Response.json({ error: "找不到這筆資料" }, { status: 404 });

  await connectDB();
  const doc = await DesignImage.findOne({ _id: id, userId: user.id }).lean();
  if (!doc) return Response.json({ error: "找不到這筆資料" }, { status: 404 });

  await deleteBlobs([doc.referenceImageUrl, ...(doc.images ?? []).map((image) => image.url)]);
  await DesignImage.deleteOne({ _id: doc._id });
  return Response.json({ ok: true });
}
