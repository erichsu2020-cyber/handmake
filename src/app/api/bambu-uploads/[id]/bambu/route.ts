import { isValidObjectId } from "mongoose";
import { getCurrentUser, unauthorized } from "@/lib/auth";
import { BambuFileError, createBambuFile } from "@/lib/bambu-file";
import { parseBambuSettings } from "@/lib/bambu-settings";
import { deleteBlobs } from "@/lib/blob-cleanup";
import { toBambuView } from "@/lib/generation-view";
import { connectDB } from "@/lib/mongodb";
import { BambuUpload } from "@/models/BambuUpload";

// 把 Bambu Studio 列印設定寫進上傳的模型，另存成新檔
export async function POST(request: Request, ctx: RouteContext<"/api/bambu-uploads/[id]/bambu">) {
  const settings = parseBambuSettings(await request.json().catch(() => null));
  if (typeof settings === "string") return Response.json({ error: settings }, { status: 400 });

  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  if (!isValidObjectId(id)) return Response.json({ error: "找不到這筆資料" }, { status: 404 });

  await connectDB();
  const doc = await BambuUpload.findOne({ _id: id, userId: user.id }, { modelFileUrl: 1, bambu: 1 }).lean();
  if (!doc) return Response.json({ error: "找不到這筆資料" }, { status: 404 });

  let bambu: Awaited<ReturnType<typeof createBambuFile>>;
  try {
    bambu = await createBambuFile(doc.modelFileUrl, settings);
  } catch (error) {
    if (error instanceof BambuFileError) return Response.json({ error: error.message }, { status: error.status });
    throw error;
  }

  await BambuUpload.updateOne({ _id: doc._id }, { $set: { bambu } });
  // 每筆只留最新一份 Bambu 檔
  if (doc.bambu?.fileUrl) await deleteBlobs([doc.bambu.fileUrl]);

  return Response.json({ bambu: toBambuView(bambu, doc.modelFileUrl) });
}
