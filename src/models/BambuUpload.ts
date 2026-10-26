import { Schema, deleteModel, model, models, type InferSchemaType, type Model } from "mongoose";
import { bambuSchema } from "@/models/bambu-schema";

// Bambu 設定頁「從電腦上傳」的模型（collection：bambuuploads）
// 上傳的 STL／3MF 會整理成簡單的 3MF（一個網格一個物件、沒有位移）再存起來，原始上傳檔就刪掉
const bambuUploadSchema = new Schema(
  {
    // 建立這筆紀錄的帳號；每個人只看得到自己的紀錄
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true, required: true },
    // 使用者電腦上的檔名，列表上顯示用
    name: { type: String, required: true },
    sourceFormat: { type: String, enum: ["STL", "3MF"], required: true },
    // 整理後的 3MF
    modelFileUrl: { type: String, required: true },
    modelFilePathname: { type: String, required: true },
    dimensionsMm: { type: [Number], required: true },
    triangles: { type: Number, required: true },
    pieces: { type: Number, required: true },
    bambu: { type: bambuSchema, required: false },
  },
  { timestamps: true },
);

export type BambuUploadDoc = InferSchemaType<typeof bambuUploadSchema>;

// 開發時程式熱重載，mongoose 會留著舊版 schema（新欄位會被默默丟掉），所以每次都重新註冊
if (models.BambuUpload) deleteModel("BambuUpload");
export const BambuUpload: Model<BambuUploadDoc> = model<BambuUploadDoc>("BambuUpload", bambuUploadSchema);
