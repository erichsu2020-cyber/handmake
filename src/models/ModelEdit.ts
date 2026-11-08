import { Schema, deleteModel, model, models, type InferSchemaType, type Model } from "mongoose";

// 「AI 改模型」的紀錄（collection：modeledits）
const modelEditSchema = new Schema(
  {
    // 建立這筆紀錄的帳號；每個人只看得到自己的紀錄
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true, required: true },
    sourceName: { type: String, required: true },
    // 上傳的 3MF、修改前的截圖、改好的 3MF：都是這筆紀錄自己的檔案（刪除紀錄時一起刪）
    sourceFileUrl: { type: String, required: true },
    snapshotUrls: { type: [String], default: [] },
    fileUrl: { type: String, required: true },
    fileName: { type: String, required: true },

    // Mixed：內容由 src/lib/model-edit-settings.ts 定義，寫入前已經驗證過
    request: { type: Schema.Types.Mixed, required: true },
    plan: { type: Schema.Types.Mixed, required: true },
    beforeMm: { type: [Number], required: true },
    afterMm: { type: [Number], required: true },
    stem: { type: Schema.Types.Mixed },
    notes: { type: [String], default: [] },
    aiModel: { type: String, required: true },
  },
  { timestamps: true },
);

export type ModelEditDoc = InferSchemaType<typeof modelEditSchema>;

// 開發時程式熱重載，mongoose 會留著舊版 schema（新欄位會被默默丟掉），所以每次都重新註冊
if (models.ModelEdit) deleteModel("ModelEdit");
export const ModelEdit: Model<ModelEditDoc> = model<ModelEditDoc>("ModelEdit", modelEditSchema);
