import { isValidObjectId, type Types } from "mongoose";
import { put } from "@vercel/blob";
import { connectDB } from "@/lib/mongodb";
import { parsePrintSettings } from "@/lib/print-settings";
import { scaleStlToHeight } from "@/lib/stl";
import { createConvertToStlTask, createImageToModelTask, getTask } from "@/lib/tripo";
import { Generation } from "@/models/Generation";

type Ctx = RouteContext<"/api/generations/[id]/model3d">;

const MAX_UPLOAD_ATTEMPTS = 3;

async function findGeneration(ctx: Ctx) {
  const { id } = await ctx.params;
  if (!isValidObjectId(id)) return null;
  await connectDB();
  return Generation.findById(id);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知錯誤";
}

// 開始：用使用者選的高度與面數，把第 1 步的圖片轉成 STL
export async function POST(request: Request, ctx: Ctx) {
  const settings = parsePrintSettings(await request.json().catch(() => null));
  if (typeof settings === "string") {
    return Response.json({ error: settings }, { status: 400 });
  }

  const generation = await findGeneration(ctx);
  if (!generation) return Response.json({ error: "找不到這筆資料" }, { status: 404 });

  const previous = generation.model3d;
  if (previous && ["generating", "converting", "uploading"].includes(previous.status)) {
    return Response.json({ error: "這張圖正在轉換中，請等它完成" }, { status: 409 });
  }

  try {
    // 之前的 3D 模型已經產生成功（有轉檔任務）→ 只要用新設定重新轉檔，省下產生模型的點數
    if (previous?.modelTaskId && previous.convertTaskId) {
      generation.model3d = {
        status: "converting",
        progress: 0,
        ...settings,
        uploadAttempts: 0,
        modelTaskId: previous.modelTaskId,
      };
      await generation.save();
      await startConvert(generation._id, previous.modelTaskId, settings.faceLimit);
    } else {
      const modelTaskId = await createImageToModelTask(generation.outputImageUrl);
      generation.model3d = {
        status: "generating",
        progress: 0,
        ...settings,
        uploadAttempts: 0,
        modelTaskId,
      };
      await generation.save();
    }
  } catch (error) {
    console.error("建立 Tripo3D 任務失敗", error);
    if (generation.model3d) await markFailed(generation._id, errorMessage(error));
    return Response.json({ error: errorMessage(error) }, { status: 502 });
  }

  const updated = await Generation.findById(generation._id, { model3d: 1 }).lean();
  return Response.json({ model3d: updated?.model3d });
}

// 查詢進度：前端輪詢這支 API，每次呼叫會推進到下一個階段
export async function GET(_request: Request, ctx: Ctx) {
  const generation = await findGeneration(ctx);
  if (!generation?.model3d) {
    return Response.json({ error: "還沒開始產生 3D 模型" }, { status: 404 });
  }

  const id = generation._id;
  const model3d = generation.model3d;

  try {
    if (model3d.status === "generating" && model3d.modelTaskId) {
      const task = await getTask(model3d.modelTaskId);

      if (task.status === "failed" || task.status === "cancelled") {
        await markFailed(id, `3D 模型產生失敗：${task.error_message ?? task.status}`);
      } else if (task.status === "success") {
        // 先搶到「轉檔」狀態再建立任務，避免同時兩個請求各建一次
        const claimed = await Generation.updateOne(
          { _id: id, "model3d.status": "generating" },
          { $set: { "model3d.status": "converting", "model3d.progress": 0 } },
        );
        if (claimed.modifiedCount === 1) {
          await startConvert(id, model3d.modelTaskId, model3d.faceLimit);
        }
      } else {
        await Generation.updateOne({ _id: id }, { $set: { "model3d.progress": task.progress } });
      }
    } else if (model3d.status === "converting" && model3d.convertTaskId) {
      const task = await getTask(model3d.convertTaskId);

      if (task.status === "failed" || task.status === "cancelled") {
        await markFailed(id, `轉換 STL 失敗：${task.error_message ?? task.status}`);
      } else if (task.status === "success" && task.output?.model_url) {
        const claimed = await Generation.updateOne(
          { _id: id, "model3d.status": "converting" },
          { $set: { "model3d.status": "uploading" } },
        );
        if (claimed.modifiedCount === 1) {
          await uploadStl(id, task.output.model_url, model3d.heightMm);
        }
      } else {
        await Generation.updateOne({ _id: id }, { $set: { "model3d.progress": task.progress } });
      }
    }
  } catch (error) {
    console.error("更新 3D 模型進度失敗", error);
    await markFailed(id, errorMessage(error));
  }

  const updated = await Generation.findById(id, { model3d: 1 }).lean();
  return Response.json({ model3d: updated?.model3d });
}

async function startConvert(id: Types.ObjectId, modelTaskId: string, faceLimit: number) {
  const convertTaskId = await createConvertToStlTask(modelTaskId, faceLimit);
  await Generation.updateOne({ _id: id }, { $set: { "model3d.convertTaskId": convertTaskId } });
}

// Tripo 的下載網址只有幾分鐘有效，所以下載後縮放到指定高度，再存到自己的 Vercel Blob
async function uploadStl(id: Types.ObjectId, modelUrl: string, heightMm: number) {
  try {
    const res = await fetch(modelUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`下載 STL 失敗 (${res.status})`);

    const { buffer, info } = scaleStlToHeight(Buffer.from(await res.arrayBuffer()), heightMm);
    const blob = await put("handmake/models/model.stl", buffer, {
      access: "public",
      contentType: "model/stl",
      addRandomSuffix: true,
    });

    await Generation.updateOne(
      { _id: id },
      {
        $set: {
          "model3d.status": "done",
          "model3d.progress": 100,
          "model3d.stlUrl": blob.url,
          "model3d.stlPathname": blob.pathname,
          "model3d.dimensionsMm": info.dimensionsMm,
          "model3d.triangles": info.triangles,
          "model3d.fileSizeBytes": buffer.length,
        },
      },
    );
  } catch (error) {
    // 退回「轉檔」狀態讓下一次輪詢重試（下載網址過期前），超過次數就放棄
    console.error("處理 STL 失敗", error);
    const updated = await Generation.findOneAndUpdate(
      { _id: id },
      { $set: { "model3d.status": "converting" }, $inc: { "model3d.uploadAttempts": 1 } },
      { new: true },
    ).lean();
    if ((updated?.model3d?.uploadAttempts ?? 0) >= MAX_UPLOAD_ATTEMPTS) {
      await markFailed(id, `處理 STL 失敗：${errorMessage(error)}`);
    }
  }
}

async function markFailed(id: Types.ObjectId, error: string) {
  await Generation.updateOne(
    { _id: id },
    { $set: { "model3d.status": "failed", "model3d.error": error } },
  );
}
