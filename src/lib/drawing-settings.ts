// 「畫圖」頁面前後端共用的設定與驗證
// 儲存時瀏覽器把每個圖層各存一張透明 PNG、再加一張合併後的預覽圖，直接上傳到 Blob（見 /api/blob-upload），
// API 只收網址

// 跟 OpenAI 產圖的尺寸一樣，之後送去做 3D 不用再縮放
export const DRAWING_SIZE = 1024;
export const MAX_LAYERS = 10;
export const MAX_TITLE_LENGTH = 100;
export const MAX_LAYER_NAME_LENGTH = 40;
export const DRAWING_FOLDER = "handmake/drawings/";
// 1024×1024 的 PNG 最多大約 4MB（每個像素都不一樣的照片），留一點餘裕
export const MAX_DRAWING_IMAGE_BYTES = 8 * 1024 * 1024;

export type DrawingLayerInput = {
  name: string;
  visible: boolean;
  opacity: number; // 0–1
  url: string;
};

export type DrawingInput = {
  title: string;
  layers: DrawingLayerInput[]; // 由下往上
  previewUrl: string;
};

const isUrl = (v: unknown): v is string => typeof v === "string" && v.startsWith("https://");

// 只檢查格式；網址是不是自己 Blob 的檔案，伺服器另外確認
export function parseDrawingInput(input: unknown): DrawingInput | string {
  const d = (input ?? {}) as Partial<DrawingInput>;
  if (typeof d.title !== "string") return "標題格式不正確";
  const title = d.title.trim() || "未命名畫作";
  if (title.length > MAX_TITLE_LENGTH) return `標題不能超過 ${MAX_TITLE_LENGTH} 字`;
  if (!isUrl(d.previewUrl)) return "預覽圖網址不正確";
  if (!Array.isArray(d.layers) || d.layers.length === 0) return "至少要有一個圖層";
  if (d.layers.length > MAX_LAYERS) return `圖層最多 ${MAX_LAYERS} 個`;

  const layers: DrawingLayerInput[] = [];
  for (const [i, raw] of d.layers.entries()) {
    const l = (raw ?? {}) as Partial<DrawingLayerInput>;
    if (typeof l.name !== "string") return `第 ${i + 1} 個圖層的名稱格式不正確`;
    const name = l.name.trim() || `圖層 ${i + 1}`;
    if (name.length > MAX_LAYER_NAME_LENGTH) return `圖層名稱不能超過 ${MAX_LAYER_NAME_LENGTH} 字`;
    if (typeof l.visible !== "boolean") return `第 ${i + 1} 個圖層的 visible 必須是 true 或 false`;
    if (typeof l.opacity !== "number" || !(l.opacity >= 0 && l.opacity <= 1)) {
      return `第 ${i + 1} 個圖層的不透明度要介於 0–1`;
    }
    if (!isUrl(l.url)) return `第 ${i + 1} 個圖層的網址不正確`;
    layers.push({ name, visible: l.visible, opacity: l.opacity, url: l.url });
  }
  return { title, layers, previewUrl: d.previewUrl };
}
