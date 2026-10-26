import { Schema, deleteModel, model, models, type InferSchemaType, type Model } from "mongoose";

// 「畫圖」頁面的畫作（collection：drawings）
// 每個圖層存一張透明 PNG，之後打開可以繼續畫；previewUrl 是所有可見圖層合併後的圖（白底）

const layerSchema = new Schema(
  {
    name: { type: String, required: true },
    visible: { type: Boolean, required: true },
    opacity: { type: Number, required: true },
    url: { type: String, required: true },
    pathname: { type: String, required: true },
  },
  { _id: false },
);

const drawingSchema = new Schema(
  {
    // 建立這筆紀錄的帳號；每個人只看得到自己的紀錄
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true, required: true },
    title: { type: String, required: true },
    width: { type: Number, required: true },
    height: { type: Number, required: true },
    // 由下往上
    layers: { type: [layerSchema], required: true },
    previewUrl: { type: String, required: true },
    previewPathname: { type: String, required: true },
  },
  { timestamps: true },
);

export type DrawingDoc = InferSchemaType<typeof drawingSchema>;

// 開發時程式熱重載，mongoose 會留著舊版 schema（新欄位會被默默丟掉），所以每次都重新註冊
if (models.Drawing) deleteModel("Drawing");
export const Drawing: Model<DrawingDoc> = model<DrawingDoc>("Drawing", drawingSchema);
