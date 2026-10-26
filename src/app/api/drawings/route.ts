import { getCurrentUser, unauthorized } from "@/lib/auth";
import { deleteBlobs } from "@/lib/blob-cleanup";
import { parseDrawingInput } from "@/lib/drawing-settings";
import { checkDrawingFiles, drawingFileUrls, toDrawingView } from "@/lib/drawings";
import { connectDB } from "@/lib/mongodb";
import { Drawing } from "@/models/Drawing";

// 新增一張畫作：瀏覽器已經把圖層和預覽圖上傳到 Blob，這裡只收網址
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const input = parseDrawingInput(await request.json().catch(() => null));
  if (typeof input === "string") return Response.json({ error: input }, { status: 400 });

  const fields = await checkDrawingFiles(input);
  if (typeof fields === "string") return Response.json({ error: fields }, { status: 400 });

  try {
    await connectDB();
    const doc = await Drawing.create({ userId: user.id, ...fields });
    return Response.json({ drawing: toDrawingView(doc.toObject()) });
  } catch (error) {
    console.error("寫入 MongoDB 失敗", error);
    await deleteBlobs(drawingFileUrls(input));
    return Response.json({ error: "圖片已上傳，但寫入資料庫失敗" }, { status: 500 });
  }
}
