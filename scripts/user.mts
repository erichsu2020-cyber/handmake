// 帳號管理（網站不開放註冊，帳號都從這裡建立）
//
//   npm run user -- add <帳號>      建立帳號（會請你輸入密碼），帳號可以是名稱（例如 originwu）或 email
//   npm run user -- reset <帳號>    重設密碼（也會解除鎖定、登出所有裝置）
//   npm run user -- list            列出所有帳號
//
// 密碼也可以用環境變數 HANDMAKE_PASSWORD 傳入（不想互動輸入時）
// 第一個建立的帳號會接收之前還沒有主人的舊紀錄

import { createInterface } from "node:readline";
import mongoose from "mongoose";
import { MIN_PASSWORD_LENGTH, hashPassword } from "../src/lib/password.ts";

// 欄位和 src/models/User.ts 一樣；直接操作 collection，因為在 Node 裡不能用 mongoose 的具名匯出載入 model
type UserRecord = {
  _id: mongoose.Types.ObjectId;
  username: string;
  passwordHash: string;
  failedLogins: number;
  lockedUntil?: Date;
  createdAt: Date;
  updatedAt: Date;
};
const users = () => mongoose.connection.db!.collection<UserRecord>("users");

function askHidden(question: string) {
  return new Promise<string>((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
    // 輸入密碼時畫面只顯示 *
    const internal = rl as unknown as { _writeToOutput: (text: string) => void };
    let muted = false;
    internal._writeToOutput = (text) => {
      process.stdout.write(muted && !text.includes("\n") ? "*".repeat(text.length) : text);
    };
    rl.question(question, (answer) => {
      rl.close();
      if (muted) process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

async function readPassword() {
  const fromEnv = process.env.HANDMAKE_PASSWORD;
  const password = fromEnv ?? (await askHidden("密碼："));
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`密碼至少要 ${MIN_PASSWORD_LENGTH} 個字`);
  if (!fromEnv && (await askHidden("再輸入一次：")) !== password) throw new Error("兩次輸入的密碼不一樣");
  return password;
}

// 把還沒有主人的舊紀錄歸給這個帳號
async function claimLegacyRecords(userId: mongoose.Types.ObjectId) {
  const db = mongoose.connection.db!;
  for (const collection of ["generations", "designimages"]) {
    const { modifiedCount } = await db
      .collection(collection)
      .updateMany({ userId: { $exists: false } }, { $set: { userId } });
    if (modifiedCount) console.log(`  ${collection}：${modifiedCount} 筆舊紀錄歸到這個帳號`);
  }
}

async function main() {
  const [command, rawName] = process.argv.slice(2);
  const username = rawName?.trim().toLowerCase();

  if (!process.env.MONGODB_URI) throw new Error("缺少環境變數 MONGODB_URI（請確認 .env.local）");
  await mongoose.connect(process.env.MONGODB_URI);

  if (command === "list") {
    const all = await users().find().sort({ createdAt: 1 }).toArray();
    if (all.length === 0) console.log("還沒有任何帳號");
    for (const u of all) {
      const locked = u.lockedUntil && u.lockedUntil > new Date() ? "（暫時鎖定中）" : "";
      console.log(`${u.username}  建立於 ${u.createdAt.toLocaleString("zh-TW")}${locked}`);
    }
    return;
  }

  if ((command !== "add" && command !== "reset") || !username) {
    console.log("用法：npm run user -- add <帳號> | reset <帳號> | list");
    process.exitCode = 1;
    return;
  }
  if (!/^[a-z0-9._@+-]{3,64}$/.test(username)) {
    throw new Error("帳號要 3–64 個字，只能用英文字母、數字和 . _ - @ +");
  }

  // 和網站上的 schema 一樣，帳號不能重複
  await users().createIndex({ username: 1 }, { unique: true });
  const existing = await users().findOne({ username });
  if (command === "add") {
    if (existing) throw new Error(`${username} 已經有帳號了，要改密碼請用 reset`);
    const passwordHash = await hashPassword(await readPassword());
    const isFirst = (await users().countDocuments()) === 0;
    const now = new Date();
    const _id = new mongoose.Types.ObjectId();
    await users().insertOne({ _id, username, passwordHash, failedLogins: 0, createdAt: now, updatedAt: now });
    console.log(`✓ 已建立帳號 ${username}`);
    if (isFirst) await claimLegacyRecords(_id);
  } else {
    if (!existing) throw new Error(`找不到 ${username} 這個帳號`);
    const passwordHash = await hashPassword(await readPassword());
    await users().updateOne(
      { _id: existing._id },
      { $set: { passwordHash, failedLogins: 0, updatedAt: new Date() }, $unset: { lockedUntil: "" } },
    );
    // 改密碼後，其他已登入的裝置都要重新登入
    const { deletedCount } = await mongoose.connection.db!.collection("sessions").deleteMany({ userId: existing._id });
    console.log(`✓ 已重設 ${username} 的密碼，登出了 ${deletedCount} 個裝置`);
  }
}

main()
  .catch((error) => {
    console.error(`✗ ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
