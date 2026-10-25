// Tripo3D API v3：https://developers.tripo3d.com/en/docs/introduction
// 注意：這把金鑰只在 .ai 網域有效，.com 會回 401
const BASE_URL = process.env.TRIPO_BASE_URL || "https://openapi.tripo3d.ai/v3";
const MODEL_VERSION = process.env.TRIPO_MODEL_VERSION || "v3.1-20260211";

export type TripoTask = {
  task_id: string;
  type: string;
  status: "queued" | "running" | "success" | "failed" | "cancelled";
  progress: number;
  output?: { model_url?: string; rendered_image_url?: string };
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

// 圖片轉 3D：只要幾何形狀（列印用不到貼圖，也比較省點數）
export async function createImageToModelTask(imageUrl: string) {
  const data = await tripoFetch<{ task_id: string }>("/generation/image-to-model", {
    method: "POST",
    body: JSON.stringify({
      input: imageUrl,
      model_version: MODEL_VERSION,
      texture: false,
      pbr: false,
    }),
  });
  return data.task_id;
}

// 轉成 STL：底部壓平、原點移到底部中心，放進切片軟體比較好擺
export async function createConvertToStlTask(modelTaskId: string) {
  const data = await tripoFetch<{ task_id: string }>("/models/convert", {
    method: "POST",
    body: JSON.stringify({
      input: modelTaskId,
      format: "STL",
      flatten_bottom: true,
      pivot_to_center_bottom: true,
    }),
  });
  return data.task_id;
}

export function getTask(taskId: string) {
  return tripoFetch<TripoTask>(`/tasks/${taskId}`);
}
