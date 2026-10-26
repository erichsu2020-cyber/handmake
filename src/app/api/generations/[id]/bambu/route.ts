import { isValidObjectId } from "mongoose";
import { put } from "@vercel/blob";
import { getCurrentUser, unauthorized } from "@/lib/auth";
import { writeBambu3mf } from "@/lib/bambu-3mf";
import { parseBambuSettings } from "@/lib/bambu-settings";
import { deleteBlobs } from "@/lib/blob-cleanup";
import type { BambuView } from "@/lib/generation-view";
import { connectDB } from "@/lib/mongodb";
import { Generation } from "@/models/Generation";

// 把 Bambu Studio 列印設定寫進已完成的 3MF，另存成新檔（原本的 3MF 不動）
export async function POST(request: Request, ctx: RouteContext<"/api/generations/[id]/bambu">) {
  const settings = parseBambuSettings(await request.json().catch(() => null));
  if (typeof settings === "string") return Response.json({ error: settings }, { status: 400 });

  const user = await getCurrentUser();
  if (!user) return unauthorized();
  const { id } = await ctx.params;
  if (!isValidObjectId(id)) return Response.json({ error: "找不到這筆資料" }, { status: 404 });

  await connectDB();
  const doc = await Generation.findOne({ _id: id, userId: user.id }, { model3d: 1, bambu: 1 }).lean();
  if (!doc) return Response.json({ error: "找不到這筆資料" }, { status: 404 });
  const m = doc.model3d;
  if (m?.status !== "done" || !m.fileUrl) {
    return Response.json({ error: "這筆的 3D 模型還沒完成" }, { status: 409 });
  }
  if (m.format !== "3MF") {
    return Response.json({ error: "只有 3MF 格式可以寫入 Bambu Studio 設定" }, { status: 400 });
  }

  let input: Buffer;
  try {
    const res = await fetch(m.fileUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`下載 3MF 失敗 (${res.status})`);
    input = Buffer.from(await res.arrayBuffer());
  } catch (error) {
    console.error("下載 3MF 失敗", error);
    return Response.json({ error: "讀取 3MF 檔失敗" }, { status: 502 });
  }

  let output: Buffer;
  try {
    output = writeBambu3mf(input, settings);
  } catch (error) {
    // 模型放不進平台等原因，訊息直接給使用者看
    console.error("寫入 Bambu 設定失敗", error);
    const message = error instanceof Error ? error.message : "寫入 Bambu 設定失敗";
    return Response.json({ error: message }, { status: 400 });
  }

  let blob: Awaited<ReturnType<typeof put>>;
  try {
    blob = await put("handmake/models/bambu/model.3mf", output, {
      access: "public",
      contentType: "model/3mf",
      addRandomSuffix: true,
    });
  } catch (error) {
    console.error("上傳 Bambu 3MF 到 Vercel Blob 失敗", error);
    return Response.json({ error: "上傳 Vercel Blob 失敗" }, { status: 500 });
  }

  const bambu = {
    settings,
    sourceFileUrl: m.fileUrl,
    fileUrl: blob.url,
    filePathname: blob.pathname,
    fileSizeBytes: output.length,
    updatedAt: new Date(),
  };
  await Generation.updateOne({ _id: doc._id }, { $set: { bambu } });
  // 每筆只留最新一份 Bambu 檔
  if (doc.bambu?.fileUrl) await deleteBlobs([doc.bambu.fileUrl]);

  const view: BambuView = {
    settings,
    fileUrl: bambu.fileUrl,
    fileSizeBytes: bambu.fileSizeBytes,
    updatedAt: bambu.updatedAt.toISOString(),
    outdated: false,
  };
  return Response.json({ bambu: view });
}
