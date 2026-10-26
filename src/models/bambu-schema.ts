import { Schema } from "mongoose";

// 寫好 Bambu Studio 設定的 3MF（Generation 和 BambuUpload 共用）
export const bambuSchema = new Schema(
  {
    // BambuSettings（src/lib/bambu-settings.ts），寫入前已經驗證過
    settings: { type: Schema.Types.Mixed, required: true },
    // 用哪一版的 3D 檔做的；之後重新處理模型，網址會變，頁面就能提醒要重做
    sourceFileUrl: { type: String, required: true },
    fileUrl: { type: String, required: true },
    filePathname: { type: String, required: true },
    fileSizeBytes: { type: Number },
    updatedAt: { type: Date, required: true },
  },
  { _id: false },
);
