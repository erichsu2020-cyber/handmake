"use server";

import { redirect } from "next/navigation";
import { createSession, deleteSession } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import { hashPassword, verifyPassword } from "@/lib/password";
import { safeNext } from "@/lib/safe-redirect";
import { User } from "@/models/User";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

// 帳號不存在時也算一次密碼，讓回應時間一樣，不會被試出哪些帳號存在
const dummyHash = hashPassword("handmake-dummy-password");

export type LoginState = { error?: string; username?: string };

export async function login(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) return { error: "請輸入帳號和密碼", username };

  await connectDB();
  const user = await User.findOne({ username });

  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    return { error: `密碼錯誤太多次，請 ${minutes} 分鐘後再試`, username };
  }

  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  if (!user || !ok) {
    if (user) {
      const failed = (user.failedLogins ?? 0) + 1;
      await User.updateOne(
        { _id: user._id },
        failed >= MAX_FAILED
          ? { $set: { failedLogins: 0, lockedUntil: new Date(Date.now() + LOCK_MINUTES * 60000) } }
          : { $set: { failedLogins: failed } },
      );
    }
    // 不說是帳號還是密碼錯，避免被用來猜帳號
    return { error: "帳號或密碼不正確", username };
  }

  await User.updateOne({ _id: user._id }, { $set: { failedLogins: 0 }, $unset: { lockedUntil: "" } });
  await createSession(String(user._id));
  redirect(safeNext(formData.get("next")));
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
