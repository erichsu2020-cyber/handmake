import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { FORMATS, MODEL_VERSIONS } from "@/lib/print-settings";
import { IMAGE_QUALITIES, STYLE_PRESETS } from "@/lib/image-settings";

// 第 2 步：Tripo3D 圖片轉 3D → 轉檔 → 縮放 → 上傳 Vercel Blob
const model3dSchema = new Schema(
  {
    status: {
      type: String,
      enum: ["generating", "converting", "uploading", "done", "failed"],
      required: true,
    },
    progress: { type: Number, default: 0 },

    // 產生模型的設定（改了要重新產生）
    modelVersion: { type: String, enum: MODEL_VERSIONS.map((v) => v.value), required: true },
    geometryQuality: { type: String, enum: ["standard", "detailed"], required: true },
    alignToImage: { type: Boolean, required: true },
    imageAutofix: { type: Boolean, required: true },
    generateParts: { type: Boolean, required: true },
    color: { type: Boolean, required: true },

    // 轉檔設定（改了只要重新轉檔）
    heightMm: { type: Number, required: true },
    faceLimit: { type: Number, required: true },
    format: { type: String, enum: FORMATS.map((f) => f.value), required: true },
    flattenBottom: { type: Boolean, required: true },

    modelTaskId: { type: String },
    convertTaskId: { type: String },

    // 完成後的結果
    fileUrl: { type: String },
    filePathname: { type: String },
    dimensionsMm: { type: [Number], default: undefined },
    triangles: { type: Number },
    fileSizeBytes: { type: Number },

    uploadAttempts: { type: Number, default: 0 },
    error: { type: String },
  },
  { _id: false },
);

const generationSchema = new Schema(
  {
    // text：只輸入文字；image：上傳圖片（可附加文字說明）
    mode: { type: String, enum: ["text", "image"], required: true },
    prompt: { type: String, default: "" },
    style: { type: String, enum: STYLE_PRESETS.map((s) => s.value), default: "none" },
    quality: { type: String, enum: IMAGE_QUALITIES.map((q) => q.value), default: "auto" },
    model: { type: String, required: true },
    // 使用者上傳的原圖與產出的圖片都放在 Vercel Blob，這裡只記錄網址
    inputImageUrl: { type: String },
    outputImageUrl: { type: String, required: true },
    outputImagePathname: { type: String, required: true },
    model3d: { type: model3dSchema, required: false },
  },
  { timestamps: true },
);

export type GenerationDoc = InferSchemaType<typeof generationSchema>;
export type Model3dDoc = NonNullable<GenerationDoc["model3d"]>;

export const Generation: Model<GenerationDoc> =
  (models.Generation as Model<GenerationDoc>) ||
  model<GenerationDoc>("Generation", generationSchema);
