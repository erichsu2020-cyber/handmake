// 前後端共用的第 1 步設定（OpenAI 產生 3D 模型圖）

export const STYLE_PRESETS = [
  { value: "none", label: "不指定", prompt: "" },
  { value: "figurine", label: "公仔", prompt: "as a cute collectible vinyl figurine with smooth surfaces" },
  { value: "wood", label: "木雕", prompt: "as a hand-carved wooden sculpture with visible carving facets" },
  { value: "metal", label: "金屬", prompt: "as a cast metal statue with a brushed metallic finish" },
  { value: "brick", label: "積木", prompt: "built from interlocking toy bricks, blocky voxel-like shapes" },
  { value: "clay", label: "黏土", prompt: "as a soft handmade clay model with rounded shapes" },
] as const;

export const IMAGE_QUALITIES = [
  { value: "low", label: "低（最快、最便宜）" },
  { value: "medium", label: "中" },
  { value: "high", label: "高（最慢、最貴）" },
  { value: "auto", label: "自動（建議）" },
] as const;

export type StylePreset = (typeof STYLE_PRESETS)[number]["value"];
export type ImageQuality = (typeof IMAGE_QUALITIES)[number]["value"];

export const DEFAULT_STYLE: StylePreset = "none";
export const DEFAULT_IMAGE_QUALITY: ImageQuality = "auto";
