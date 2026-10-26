import { Schema, deleteModel, model, models, type InferSchemaType, type Model } from "mongoose";

// 「設計 3D 圖」頁面的紀錄，與第 1／2 步的 Generation 分開存放（collection：designimages）

const imageSchema = new Schema(
  {
    url: { type: String, required: true },
    pathname: { type: String, required: true },
  },
  { _id: false },
);

const designImageSchema = new Schema(
  {
    // 建立這筆紀錄的帳號；每個人只看得到自己的紀錄
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    // 使用者填寫的表單內容
    // 有參考圖時可以不填（空字串）
    subject: { type: String, default: "" },
    details: { type: String, default: "" },
    style: { type: String, required: true },
    material: { type: String, required: true },
    colors: { type: [String], default: [] },
    view: { type: String, required: true },
    lighting: { type: String, required: true },
    background: { type: String, required: true },
    printFriendly: { type: Boolean, required: true },
    avoid: { type: String, default: "" },
    size: { type: String, required: true },
    quality: { type: String, required: true },
    count: { type: Number, required: true },

    // 實際送出的提示詞與模型
    prompt: { type: String, required: true },
    model: { type: String, required: true },

    referenceImageUrl: { type: String },
    images: { type: [imageSchema], required: true },
  },
  { timestamps: true },
);

export type DesignImageDoc = InferSchemaType<typeof designImageSchema>;

// 開發時程式熱重載，mongoose 會留著舊版 schema（新欄位會被默默丟掉），所以每次都重新註冊
if (models.DesignImage) deleteModel("DesignImage");
export const DesignImage: Model<DesignImageDoc> = model<DesignImageDoc>("DesignImage", designImageSchema);
