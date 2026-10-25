import { Schema, deleteModel, model, models, type InferSchemaType, type Model } from "mongoose";
import { APPEARANCE_MATERIALS, FORMATS, MODEL_VERSIONS } from "@/lib/print-settings";
import { IMAGE_QUALITIES, STYLE_PRESETS } from "@/lib/image-settings";

// 第 2 步：Tripo3D 產生模型 →（外觀材質）→ 轉檔 → 本機處理 → 上傳 Vercel Blob
const model3dSchema = new Schema(
  {
    status: {
      type: String,
      // uploading：正在把 Tripo 的檔案存到 Blob；processing：本機縮放、切開、空心化
      enum: ["generating", "texturing", "converting", "uploading", "processing", "done", "failed"],
      required: true,
    },
    progress: { type: Number, default: 0 },

    // 1. 產生模型
    modelVersion: { type: String, enum: MODEL_VERSIONS.map((v) => v.value), required: true },
    geometryQuality: { type: String, enum: ["standard", "detailed"], required: true },
    alignToImage: { type: Boolean, required: true },
    imageAutofix: { type: Boolean, required: true },
    generateParts: { type: Boolean, required: true },
    color: { type: Boolean, required: true },
    // 2. 外觀材質
    appearance: { type: String, enum: APPEARANCE_MATERIALS.map((m) => m.value), default: "none" },
    // 3. 轉檔
    faceLimit: { type: Number, required: true },
    format: { type: String, enum: FORMATS.map((f) => f.value), required: true },
    flattenBottom: { type: Boolean, required: true },
    // 4. 本機處理
    sizeMode: { type: String, enum: ["axis", "fit", "xyz"], default: "axis" },
    sizeAxis: { type: String, enum: ["height", "width", "depth"], default: "height" },
    sizeMm: { type: Number },
    bedX: { type: Number },
    bedY: { type: Number },
    bedZ: { type: Number },
    sizeX: { type: Number },
    sizeY: { type: Number },
    sizeZ: { type: Number },
    trimBottomMm: { type: Number, default: 0 },
    cutAtPercent: { type: Number, default: 0 },
    hollowWallMm: { type: Number, default: 0 },
    drainHole: { type: Boolean, default: false },

    // Tripo 任務
    modelTaskId: { type: String },
    modelReady: { type: Boolean, default: false },
    textureTaskId: { type: String },
    textureReady: { type: Boolean, default: false },
    convertTaskId: { type: String },

    // Tripo 轉出來的原始檔（存起來，之後改尺寸／切開／空心化不用再扣點數）
    rawFileUrl: { type: String },
    rawFilePathname: { type: String },
    processingClaimedAt: { type: Date },
    // 上一版的檔案：新版本處理成功後就刪掉，節省 Blob 空間
    staleFileUrls: { type: [String], default: undefined },

    // 完成後的結果
    fileUrl: { type: String },
    filePathname: { type: String },
    dimensionsMm: { type: [Number], default: undefined },
    triangles: { type: Number },
    pieces: { type: Number },
    fileSizeBytes: { type: Number },
    stats: {
      volumeMm3: Number,
      surfaceAreaMm2: Number,
      overhangAreaMm2: Number,
      overhangVolumeMm3: Number,
    },

    uploadAttempts: { type: Number, default: 0 },
    error: { type: String },
  },
  { _id: false },
);

const generationSchema = new Schema(
  {
    // 建立這筆紀錄的帳號；每個人只看得到自己的紀錄
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
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

// 開發時程式熱重載，mongoose 會留著舊版 schema（新欄位會被默默丟掉），所以每次都重新註冊
if (models.Generation) deleteModel("Generation");
export const Generation: Model<GenerationDoc> = model<GenerationDoc>("Generation", generationSchema);
