import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

const imageSchema = new Schema(
  {
    data: { type: Buffer, required: true },
    contentType: { type: String, required: true },
  },
  { _id: false },
);

// 第 2 步：Tripo3D 圖片轉 3D → 轉成 STL → 上傳 Vercel Blob
const model3dSchema = new Schema(
  {
    status: {
      type: String,
      enum: ["generating", "converting", "uploading", "done", "failed"],
      required: true,
    },
    progress: { type: Number, default: 0 },
    modelTaskId: { type: String },
    convertTaskId: { type: String },
    stlUrl: { type: String },
    stlPathname: { type: String },
    error: { type: String },
  },
  { _id: false },
);

const generationSchema = new Schema(
  {
    // text：只輸入文字；image：上傳圖片（可附加文字說明）
    mode: { type: String, enum: ["text", "image"], required: true },
    prompt: { type: String, default: "" },
    model: { type: String, required: true },
    inputImage: { type: imageSchema, required: false },
    // 產出的圖片存放在 Vercel Blob，這裡只記錄網址
    outputImageUrl: { type: String, required: true },
    outputImagePathname: { type: String, required: true },
    model3d: { type: model3dSchema, required: false },
  },
  { timestamps: true },
);

export type GenerationDoc = InferSchemaType<typeof generationSchema>;

export const Generation: Model<GenerationDoc> =
  (models.Generation as Model<GenerationDoc>) ||
  model<GenerationDoc>("Generation", generationSchema);
