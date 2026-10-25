import { isValidObjectId } from "mongoose";
import { deleteBlobs } from "@/lib/blob-cleanup";
import { getCurrentUser, unauthorized } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { Generation } from "@/models/Generation";

const BUSY = ["generating", "texturing", "converting", "uploading", "processing"];

// 刪除一筆紀錄，連同 Vercel Blob 上的原圖、3D 模型圖、3D 檔、Tripo 原始檔
export async function DELETE(_request: Request, ctx: RouteContext<"/api/generations/[id]">) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  if (!isValidObjectId(id)) return Response.json({ error: "找不到這筆資料" }, { status: 404 });

  await connectDB();
  const doc = await Generation.findOne({ _id: id, userId: user.id }).lean();
  if (!doc) return Response.json({ error: "找不到這筆資料" }, { status: 404 });

  // 處理中刪掉的話，背景的步驟還會繼續寫入，先擋下來
  const status = String(doc.model3d?.status ?? "").replace(":claimed", "");
  if (BUSY.includes(status)) {
    return Response.json({ error: "這筆正在轉 3D，請等它完成再刪除" }, { status: 409 });
  }

  const legacy = doc.model3d as { stlUrl?: string } | undefined;
  await deleteBlobs([
    doc.inputImageUrl,
    doc.outputImageUrl,
    doc.model3d?.fileUrl,
    doc.model3d?.rawFileUrl,
    legacy?.stlUrl,
    ...(doc.model3d?.staleFileUrls ?? []),
  ]);

  await Generation.deleteOne({ _id: doc._id });
  return Response.json({ ok: true });
}
