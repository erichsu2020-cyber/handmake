import { isValidObjectId, type Types } from "mongoose";
import { put } from "@vercel/blob";
import { deleteBlobs } from "@/lib/blob-cleanup";
import { getCurrentUser, unauthorized } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { toModel3dView } from "@/lib/generation-view";
import { processModelFile } from "@/lib/model-file";
import {
  APPEARANCE_MATERIALS,
  FORMATS,
  parseModelSettings,
  sameConvertOptions,
  sameGenerateOptions,
  sameTextureOptions,
  type ModelSettings,
} from "@/lib/print-settings";
import { createConvertTask, createImageToModelTask, createTextureTask, getTask } from "@/lib/tripo";
import { Generation, type Model3dDoc } from "@/models/Generation";

type Ctx = RouteContext<"/api/generations/[id]/model3d">;

const MAX_UPLOAD_ATTEMPTS = 3;
// 處理中的請求如果中斷（例如伺服器重啟），超過這個時間就允許重新處理
const PROCESSING_STALE_MS = 3 * 60 * 1000;
const BUSY = ["generating", "texturing", "converting", "uploading", "processing"];

// 只找得到自己的紀錄；沒登入回傳 "unauthorized"
async function findGeneration(ctx: Ctx) {
  const user = await getCurrentUser();
  if (!user) return "unauthorized" as const;
  const { id } = await ctx.params;
  if (!isValidObjectId(id)) return null;
  await connectDB();
  return Generation.findOne({ _id: id, userId: user.id });
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "未知錯誤";
}

async function currentView(id: Types.ObjectId) {
  const updated = await Generation.findById(id, { model3d: 1 }).lean();
  return toModel3dView(updated?.model3d);
}

const needsTexture = (s: Pick<ModelSettings, "color" | "appearance">) => s.color && s.appearance !== "none";
const texturePrompt = (s: Pick<ModelSettings, "appearance">) =>
  APPEARANCE_MATERIALS.find((m) => m.value === s.appearance)?.prompt ?? "";

// 開始：依照改了哪些設定，從最省點數的步驟開始重做
export async function POST(request: Request, ctx: Ctx) {
  const settings = parseModelSettings(await request.json().catch(() => null));
  if (typeof settings === "string") {
    return Response.json({ error: settings }, { status: 400 });
  }

  const generation = await findGeneration(ctx);
  if (generation === "unauthorized") return unauthorized();
  if (!generation) return Response.json({ error: "找不到這筆資料" }, { status: 404 });

  const prev = generation.model3d;
  if (prev && BUSY.includes(prev.status)) {
    return Response.json({ error: "這張圖正在處理中，請等它完成" }, { status: 409 });
  }

  // 資料庫的欄位可能是 null，比對設定時當成「沒有設定」
  const prevSettings = (prev ?? {}) as unknown as Partial<ModelSettings>;
  // 舊資料沒有 modelReady，有轉檔任務就代表模型產生成功過
  const modelReady = !!prev?.modelTaskId && (prev.modelReady || !!prev.convertTaskId);
  const reuseModel = modelReady && sameGenerateOptions(prevSettings, settings);
  const reuseTexture =
    reuseModel && (!needsTexture(settings) || (!!prev!.textureReady && sameTextureOptions(prevSettings, settings)));
  const reuseRaw = reuseTexture && !!prev!.rawFileUrl && sameConvertOptions(prevSettings, settings);

  // 上一版的成品一定會被取代；原始檔沒有沿用的話也會被取代
  // 上一次失敗時還沒刪掉的舊檔也一起帶著
  const staleFileUrls = [
    prev?.fileUrl,
    reuseRaw ? null : prev?.rawFileUrl,
    ...(prev?.staleFileUrls ?? []),
  ].filter((url): url is string => Boolean(url));
  const base = { ...settings, progress: 0, uploadAttempts: 0, staleFileUrls };
  const kept = {
    modelTaskId: reuseModel ? prev!.modelTaskId : undefined,
    modelReady: reuseModel,
    textureTaskId: reuseTexture && needsTexture(settings) ? prev!.textureTaskId : undefined,
    textureReady: reuseTexture && needsTexture(settings),
  };

  try {
    if (reuseRaw) {
      // 只改了尺寸、切開、空心化 → 用存起來的原始檔重新處理，不扣點數
      generation.model3d = {
        ...base,
        ...kept,
        status: "processing",
        convertTaskId: prev!.convertTaskId,
        rawFileUrl: prev!.rawFileUrl,
        rawFilePathname: prev!.rawFilePathname,
      };
    } else if (reuseTexture) {
      const source = needsTexture(settings) ? kept.textureTaskId! : kept.modelTaskId!;
      const convertTaskId = await createConvertTask(source, settings);
      generation.model3d = { ...base, ...kept, status: "converting", convertTaskId };
    } else if (reuseModel) {
      const textureTaskId = await createTextureTask(kept.modelTaskId!, texturePrompt(settings));
      generation.model3d = { ...base, ...kept, status: "texturing", textureTaskId, textureReady: false };
    } else {
      const modelTaskId = await createImageToModelTask(generation.outputImageUrl, settings);
      generation.model3d = { ...base, status: "generating", modelTaskId, modelReady: false, textureReady: false };
    }
    await generation.save();
  } catch (error) {
    console.error("建立 Tripo3D 任務失敗", error);
    return Response.json({ error: errorMessage(error) }, { status: 502 });
  }

  return Response.json({ model3d: await currentView(generation._id) });
}

// 查詢進度：前端輪詢這支 API，每次呼叫會推進到下一個階段
export async function GET(_request: Request, ctx: Ctx) {
  const generation = await findGeneration(ctx);
  if (generation === "unauthorized") return unauthorized();
  if (!generation?.model3d) {
    return Response.json({ error: "還沒開始產生 3D 模型" }, { status: 404 });
  }

  const id = generation._id;
  const m = generation.model3d;

  try {
    if (m.status === "generating" && m.modelTaskId) {
      await advanceTripoTask(id, m.modelTaskId, "generating", "3D 模型產生失敗", async () => {
        await Generation.updateOne({ _id: id }, { $set: { "model3d.modelReady": true } });
        if (needsTexture(m as ModelSettings)) {
          const textureTaskId = await createTextureTask(m.modelTaskId!, texturePrompt(m as ModelSettings));
          await setStage(id, "texturing", { "model3d.textureTaskId": textureTaskId });
        } else {
          const convertTaskId = await createConvertTask(m.modelTaskId!, m);
          await setStage(id, "converting", { "model3d.convertTaskId": convertTaskId });
        }
      });
    } else if (m.status === "texturing" && m.textureTaskId) {
      await advanceTripoTask(id, m.textureTaskId, "texturing", "上外觀材質失敗", async () => {
        await Generation.updateOne({ _id: id }, { $set: { "model3d.textureReady": true } });
        const convertTaskId = await createConvertTask(m.textureTaskId!, m);
        await setStage(id, "converting", { "model3d.convertTaskId": convertTaskId });
      });
    } else if (m.status === "converting" && m.convertTaskId) {
      await advanceTripoTask(id, m.convertTaskId, "converting", "轉檔失敗", async (task) => {
        await Generation.updateOne({ _id: id }, { $set: { "model3d.status": "uploading" } });
        await saveRawFile(id, task.output!.model_url!, m);
      });
    } else if (m.status === "processing") {
      await processFile(id, m);
    }
  } catch (error) {
    console.error("更新 3D 模型進度失敗", error);
    await markFailed(id, errorMessage(error));
  }

  return Response.json({ model3d: await currentView(id) });
}

// 查 Tripo 任務：失敗就標記失敗；成功就先「搶」到下一步（避免兩個請求同時建任務），再執行 onSuccess
async function advanceTripoTask(
  id: Types.ObjectId,
  taskId: string,
  stage: "generating" | "texturing" | "converting",
  failMessage: string,
  onSuccess: (task: Awaited<ReturnType<typeof getTask>>) => Promise<void>,
) {
  const task = await getTask(taskId);

  if (task.status === "failed" || task.status === "cancelled") {
    await markFailed(id, `${failMessage}：${task.error_message ?? task.status}`);
  } else if (task.status === "success") {
    const claimed = await Generation.updateOne(
      { _id: id, "model3d.status": stage },
      { $set: { "model3d.status": `${stage}:claimed` } },
    );
    if (claimed.modifiedCount === 1) await onSuccess(task);
  } else {
    await Generation.updateOne({ _id: id }, { $set: { "model3d.progress": task.progress } });
  }
}

async function setStage(id: Types.ObjectId, status: string, extra: Record<string, unknown>) {
  await Generation.updateOne(
    { _id: id },
    { $set: { "model3d.status": status, "model3d.progress": 0, ...extra } },
  );
}

// Tripo 的下載網址只有幾分鐘有效，所以先把原始檔存到自己的 Vercel Blob
async function saveRawFile(id: Types.ObjectId, modelUrl: string, m: Model3dDoc) {
  const format = FORMATS.find((f) => f.value === m.format)!;
  try {
    const res = await fetch(modelUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`下載模型檔失敗 (${res.status})`);
    const blob = await put(`handmake/models/raw/tripo.${format.ext === "obj" ? "zip" : format.ext}`, Buffer.from(await res.arrayBuffer()), {
      access: "public",
      addRandomSuffix: true,
    });
    await setStage(id, "processing", {
      "model3d.rawFileUrl": blob.url,
      "model3d.rawFilePathname": blob.pathname,
    });
  } catch (error) {
    // 退回「轉檔」狀態讓下一次輪詢重試（下載網址過期前），超過次數就放棄
    console.error("儲存原始檔失敗", error);
    const updated = await Generation.findOneAndUpdate(
      { _id: id },
      { $set: { "model3d.status": "converting" }, $inc: { "model3d.uploadAttempts": 1 } },
      { new: true },
    ).lean();
    if ((updated?.model3d?.uploadAttempts ?? 0) >= MAX_UPLOAD_ATTEMPTS) {
      await markFailed(id, `儲存模型檔失敗：${errorMessage(error)}`);
    }
  }
}

// 本機處理：縮放尺寸、切底部、空心化、切開（不呼叫 Tripo、不扣點數）
async function processFile(id: Types.ObjectId, m: Model3dDoc) {
  const stale = new Date(Date.now() - PROCESSING_STALE_MS);
  const claimed = await Generation.updateOne(
    {
      _id: id,
      "model3d.status": "processing",
      $or: [{ "model3d.processingClaimedAt": null }, { "model3d.processingClaimedAt": { $lt: stale } }],
    },
    { $set: { "model3d.processingClaimedAt": new Date(), "model3d.progress": 50 } },
  );
  if (claimed.modifiedCount !== 1 || !m.rawFileUrl) return;

  const format = FORMATS.find((f) => f.value === m.format)!;
  try {
    const res = await fetch(m.rawFileUrl, { cache: "no-store" });
    if (!res.ok) throw new Error(`讀取原始檔失敗 (${res.status})`);

    const { buffer, info } = await processModelFile(
      format.value,
      Buffer.from(await res.arrayBuffer()),
      m as unknown as ModelSettings,
    );
    const blob = await put(`handmake/models/model.${format.ext}`, buffer, {
      access: "public",
      contentType: format.contentType,
      addRandomSuffix: true,
    });

    await Generation.updateOne(
      { _id: id },
      {
        $set: {
          "model3d.status": "done",
          "model3d.progress": 100,
          "model3d.fileUrl": blob.url,
          "model3d.filePathname": blob.pathname,
          "model3d.dimensionsMm": info.dimensionsMm,
          "model3d.triangles": info.triangles,
          "model3d.pieces": info.pieces,
          "model3d.stats": info.stats,
          "model3d.fileSizeBytes": buffer.length,
        },
        $unset: { "model3d.processingClaimedAt": "", "model3d.error": "", "model3d.staleFileUrls": "" },
      },
    );
    // 新版本完成後才刪舊檔，處理失敗時舊檔還在（之後可用「清理儲存空間」刪掉）
    await deleteBlobs(m.staleFileUrls ?? []);
  } catch (error) {
    console.error("處理模型檔失敗", error);
    await Generation.updateOne({ _id: id }, { $unset: { "model3d.processingClaimedAt": "" } });
    await markFailed(id, errorMessage(error));
  }
}

async function markFailed(id: Types.ObjectId, error: string) {
  await Generation.updateOne(
    { _id: id },
    { $set: { "model3d.status": "failed", "model3d.error": error } },
  );
}
