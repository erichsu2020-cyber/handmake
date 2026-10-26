import { Schema, deleteModel, model, models, type InferSchemaType, type Model } from "mongoose";

// 「成品改良」的紀錄（collection：printreviews）
const printReviewSchema = new Schema(
  {
    // 建立這筆紀錄的帳號；每個人只看得到自己的紀錄
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true, required: true },
    // 來源種類見 src/lib/bambu-source.ts 的 BambuSource（file：這頁直接上傳的 3MF）
    sourceType: { type: String, enum: ["generation", "upload", "check", "file"], required: true },
    sourceId: { type: String },
    sourceName: { type: String, required: true },
    // 列印用的檔案；file 來源時是這筆紀錄自己的檔案（刪除紀錄時一起刪），其他來源是別的紀錄的檔案
    sourceFileUrl: { type: String, required: true },
    photoUrls: { type: [String], required: true },
    snapshotUrls: { type: [String], default: [] },

    // Mixed：內容由 src/lib/print-review-settings.ts、bambu-project.ts 定義，寫入前已經驗證過
    details: { type: Schema.Types.Mixed, required: true },
    settings: { type: Schema.Types.Mixed, required: true },
    geometry: { type: Schema.Types.Mixed, required: true },
    report: { type: Schema.Types.Mixed, required: true },
    applied: { type: Schema.Types.Mixed, default: [] },
    rejected: { type: Schema.Types.Mixed, default: [] },
    aiModel: { type: String, required: true },

    // 套用設定修改後的 3MF；沒有任何修改時就沒有
    fixedFileUrl: { type: String },
    fixedFilePathname: { type: String },
  },
  { timestamps: true },
);

export type PrintReviewDoc = InferSchemaType<typeof printReviewSchema>;

// 開發時程式熱重載，mongoose 會留著舊版 schema（新欄位會被默默丟掉），所以每次都重新註冊
if (models.PrintReview) deleteModel("PrintReview");
export const PrintReview: Model<PrintReviewDoc> = model<PrintReviewDoc>("PrintReview", printReviewSchema);
