import { isValidObjectId } from "mongoose";
import { getCurrentUser, unauthorized } from "@/lib/auth";
import { deleteBlobs } from "@/lib/blob-cleanup";
import { parseDrawingInput } from "@/lib/drawing-settings";
import { checkDrawingFiles, drawingFileUrls, toDrawingView } from "@/lib/drawings";
import { connectDB } from "@/lib/mongodb";
import { Drawing } from "@/models/Drawing";

type Ctx = RouteContext<"/api/drawings/[id]">;

// 只找得到自己的紀錄；沒登入回傳 "unauthorized"
async function findDrawing(ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) return "unauthorized" as const;
  const { id } = await ctx.params;
  if (!isValidObjectId(id)) return null;
  await connectDB();
  return Drawing.findOne({ _id: id, userId: user.id }).lean();
}

// 讀取一張畫作（設計頁、建立頁帶入畫作時用）
export async function GET(_request: Request, ctx: Ctx) {
  const doc = await findDrawing(ctx);
  if (doc === "unauthorized") return unauthorized();
  if (!doc) return Response.json({ error: "找不到這張畫作" }, { status: 404 });
  return Response.json({ drawing: toDrawingView(doc) });
}

// 更新畫作：沒改過的圖層瀏覽器會沿用原本的網址，換掉的舊檔案在這裡刪掉
export async function PUT(request: Request, ctx: Ctx) {
  const doc = await findDrawing(ctx);
  if (doc === "unauthorized") return unauthorized();
  if (!doc) return Response.json({ error: "找不到這張畫作" }, { status: 404 });

  const input = parseDrawingInput(await request.json().catch(() => null));
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });

  const fields = await checkDrawingFiles(input);
  if (typeof fields === "string") return Response.json({ error: fields }, { status: 400 });

  const updated = await Drawing.findOneAndUpdate({ _id: doc._id }, { $set: fields }, { new: true }).lean();
  const keep = new Set(drawingFileUrls(input));
  await deleteBlobs(drawingFileUrls(doc).filter((url) => url && !keep.has(url)));
  return Response.json({ drawing: toDrawingView(updated) });
}

// 刪除畫作，連同 Blob 上的圖層和預覽圖
export async function DELETE(_request: Request, ctx: Ctx) {
  const doc = await findDrawing(ctx);
  if (doc === "unauthorized") return unauthorized();
  if (!doc) return Response.json({ error: "找不到這張畫作" }, { status: 404 });

  await deleteBlobs(drawingFileUrls(doc));
  await Drawing.deleteOne({ _id: doc._id });
  return Response.json({ ok: true });
}
