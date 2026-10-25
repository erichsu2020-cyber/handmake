import { Schema, deleteModel, model, models, type InferSchemaType, type Model } from "mongoose";

// 登入狀態。瀏覽器的 cookie 只放隨機 token，這裡只存它的 SHA-256，
// 就算資料庫外洩也拿不到可用的 token；登出時刪掉這筆就立刻失效
const sessionSchema = new Schema({
  tokenHash: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  // MongoDB 會在過期後自動刪除（TTL index）
  expiresAt: { type: Date, required: true, expires: 0 },
});

export type SessionDoc = InferSchemaType<typeof sessionSchema>;

if (models.Session) deleteModel("Session");
export const Session: Model<SessionDoc> = model<SessionDoc>("Session", sessionSchema);
