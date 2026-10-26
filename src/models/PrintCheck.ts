import { Schema, deleteModel, model, models, type InferSchemaType, type Model } from "mongoose";

// 「AI 列印檢查」的紀錄（collection：printchecks）
const printCheckSchema = new Schema(
  {
    // 建立這筆紀錄的帳號；每個人只看得到自己的紀錄
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true, required: true },
    // generation：Bambu 設定頁網站模型的 Bambu 檔；upload：Bambu 設定頁上傳模型的 Bambu 檔；file：這頁直接上傳的 3MF
    sourceType: { type: String, enum: ["generation", "upload", "file"], required: true },
    sourceId: { type: String },
    sourceName: { type: String, required: true },
    // 檢查的檔案；file 來源時是這筆紀錄自己的檔案（刪除紀錄時一起刪），其他來源是別的紀錄的檔案
    sourceFileUrl: { type: String, required: true },
    snapshotUrls: { type: [String], default: [] },

    // Mixed：內容由 src/lib/print-check-settings.ts、bambu-project.ts 定義，寫入前已經驗證過
    requirements: { type: Schema.Types.Mixed, required: true },
    settings: { type: Schema.Types.Mixed, required: true },
    geometry: { type: Schema.Types.Mixed, required: true },
    estimate: { type: Schema.Types.Mixed, required: true },
    report: { type: Schema.Types.Mixed, required: true },
    // AI 建議的修改：成功套用的、被擋下的（超出範圍等）
    applied: { type: Schema.Types.Mixed, default: [] },
    rejected: { type: Schema.Types.Mixed, default: [] },
    aiModel: { type: String, required: true },

    // 套用修改後的 3MF；沒有任何修改時就沒有
    fixedFileUrl: { type: String },
    fixedFilePathname: { type: String },
  },
  { timestamps: true },
);

export type PrintCheckDoc = InferSchemaType<typeof printCheckSchema>;

// 開發時程式熱重載，mongoose 會留著舊版 schema（新欄位會被默默丟掉），所以每次都重新註冊
if (models.PrintCheck) deleteModel("PrintCheck");
export const PrintCheck: Model<PrintCheckDoc> = model<PrintCheckDoc>("PrintCheck", printCheckSchema);
