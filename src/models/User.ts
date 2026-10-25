import { Schema, deleteModel, model, models, type InferSchemaType, type Model } from "mongoose";

// 登入帳號。不開放註冊，帳號用 npm run user 指令建立（scripts/user.mts）
const userSchema = new Schema(
  {
    // 帳號名稱（例如 originwu），也可以用 email
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    // 只存加密後的密碼（見 lib/password.ts），不存原始密碼
    passwordHash: { type: String, required: true },
    // 連續輸錯密碼的次數；太多次就暫時鎖住
    failedLogins: { type: Number, default: 0 },
    lockedUntil: { type: Date },
  },
  { timestamps: true },
);

export type UserDoc = InferSchemaType<typeof userSchema>;

// 開發時程式熱重載，mongoose 會留著舊版 schema（新欄位會被默默丟掉），所以每次都重新註冊
if (models.User) deleteModel("User");
export const User: Model<UserDoc> = model<UserDoc>("User", userSchema);
