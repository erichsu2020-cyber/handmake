import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

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
    // 使用者填寫的表單內容
    subject: { type: String, required: true },
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

export const DesignImage: Model<DesignImageDoc> =
  (models.DesignImage as Model<DesignImageDoc>) ||
  model<DesignImageDoc>("DesignImage", designImageSchema);
