import { isValidObjectId } from "mongoose";
import { put } from "@vercel/blob";
import { connectDB } from "@/lib/mongodb";
import { createConvertToStlTask, createImageToModelTask, getTask } from "@/lib/tripo";
import { Generation } from "@/models/Generation";

type Ctx = RouteContext<"/api/generations/[id]/model3d">;

async function findGeneration(ctx: Ctx) {
  const { id } = await ctx.params;
  if (!isValidObjectId(id)) return null;
  await connectDB();
  return Generation.findById(id);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知錯誤";
}

// 開始：把第 1 步產出的圖片送到 Tripo3D 產生 3D 模型
export async function POST(_request: Request, ctx: Ctx) {
  const generation = await findGeneration(ctx);
  if (!generation) return Response.json({ error: "找不到這筆資料" }, { status: 404 });

  // 已經在跑或已完成就不重複送出，避免重複扣點
  if (generation.model3d && generation.model3d.status !== "failed") {
    return Response.json({ model3d: generation.model3d });
  }

  try {
    const modelTaskId = await createImageToModelTask(generation.outputImageUrl);
    generation.model3d = { status: "generating", progress: 0, modelTaskId };
    await generation.save();
    return Response.json({ model3d: generation.model3d });
  } catch (error) {
    console.error("建立 Tripo3D 任務失敗", error);
    return Response.json({ error: errorMessage(error) }, { status: 502 });
  }
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
          const convertTaskId = await createConvertToStlTask(model3d.modelTaskId);
          await Generation.updateOne({ _id: id }, { $set: { "model3d.convertTaskId": convertTaskId } });
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
          await uploadStl(id, task.output.model_url);
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

// Tripo 的下載網址只有幾分鐘有效，所以下載後存到自己的 Vercel Blob
async function uploadStl(id: unknown, modelUrl: string) {
  try {
    const res = await fetch(modelUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`下載 STL 失敗 (${res.status})`);

    const blob = await put("handmake/models/model.stl", Buffer.from(await res.arrayBuffer()), {
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
        },
      },
    );
  } catch (error) {
    // 退回「轉檔」狀態，下一次輪詢會重試（下載網址過期前）
    console.error("上傳 STL 失敗，稍後重試", error);
    await Generation.updateOne({ _id: id }, { $set: { "model3d.status": "converting" } });
  }
}

async function markFailed(id: unknown, error: string) {
  await Generation.updateOne(
    { _id: id },
    { $set: { "model3d.status": "failed", "model3d.error": error } },
  );
}
