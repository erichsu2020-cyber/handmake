import { isP1, type ConvertOptions, type GenerateOptions } from "@/lib/print-settings";

// Tripo3D API v3：https://developers.tripo3d.com/en/docs/introduction
// 注意：這把金鑰只在 .ai 網域有效，.com 會回 401
const BASE_URL = process.env.TRIPO_BASE_URL || "https://openapi.tripo3d.ai/v3";

export type TripoTask = {
  task_id: string;
  type: string;
  status: "queued" | "running" | "success" | "failed" | "cancelled";
  progress: number;
  output?: { model_url?: string; rendered_image_url?: string };
  credits_consumed?: number;
  error_code?: number;
  error_message?: string;
};

async function tripoFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = process.env.TRIPO_API_KEY;
  if (!apiKey) throw new Error("缺少環境變數 TRIPO_API_KEY，請在 .env.local 設定");

  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  const body = await res.json().catch(() => null);

  if (!res.ok || body?.code !== 0) {
    throw new Error(`Tripo API 錯誤 (${res.status})：${body?.message ?? "未知錯誤"}`);
  }
  return body.data as T;
}

// 圖片轉 3D。沒開彩色時只要幾何形狀（列印用不到貼圖，也比較省點數）
export async function createImageToModelTask(imageUrl: string, options: GenerateOptions) {
  const p1 = isP1(options.modelVersion);
  const data = await tripoFetch<{ task_id: string }>("/generation/image-to-model", {
    method: "POST",
    body: JSON.stringify({
      input: imageUrl,
      model_version: options.modelVersion,
      texture: options.color,
      pbr: false,
      orientation: options.alignToImage ? "align_image" : "default",
      enable_image_autofix: options.imageAutofix,
      // P1 版本連 false 都不能帶，只能完全省略
      ...(p1
        ? {}
        : { geometry_quality: options.geometryQuality, generate_parts: options.generateParts }),
    }),
  });
  return data.task_id;
}

// 外觀材質：用文字描述重新上貼圖（實測 10 點）
export async function createTextureTask(modelTaskId: string, prompt: string) {
  const data = await tripoFetch<{ task_id: string }>("/models/texture", {
    method: "POST",
    body: JSON.stringify({
      original_model_task_id: modelTaskId,
      texture_prompt: { text: prompt },
      pbr: false,
    }),
  });
  return data.task_id;
}

// 轉檔：減面、底部壓平、原點移到底部中心；彩色 OBJ 會把顏色存在頂點上
// sourceTaskId 是產生模型或上貼圖的任務
export async function createConvertTask(
  sourceTaskId: string,
  options: ConvertOptions & { color: boolean },
) {
  const data = await tripoFetch<{ task_id: string }>("/models/convert", {
    method: "POST",
    body: JSON.stringify({
      input: sourceTaskId,
      format: options.format,
      face_limit: options.faceLimit,
      flatten_bottom: options.flattenBottom,
      pivot_to_center_bottom: true,
      ...(options.format === "OBJ" && options.color ? { export_vertex_colors: true } : {}),
    }),
  });
  return data.task_id;
}

export function getTask(taskId: string) {
  return tripoFetch<TripoTask>(`/tasks/${taskId}`);
}
