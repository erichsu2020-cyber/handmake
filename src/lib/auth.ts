import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";
import { connectDB } from "@/lib/mongodb";
import { SESSION_COOKIE, SESSION_DAYS } from "@/lib/session-cookie";
import { Session } from "@/models/Session";
import { User } from "@/models/User";

// 所有「目前是誰登入」的判斷都集中在這裡；頁面和 API 都要自己呼叫，不能只靠 proxy

export type CurrentUser = { id: string; email: string };

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await connectDB();
  await Session.create({ tokenHash: hashToken(token), userId, expiresAt });

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, // JavaScript 讀不到，降低被 XSS 偷走的風險
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function deleteSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await connectDB();
    await Session.deleteOne({ tokenHash: hashToken(token) });
  }
  store.delete(SESSION_COOKIE);
}

// 同一個請求裡重複呼叫只查一次資料庫
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  // 要用現在時間判斷是否過期，所以一定要在請求當下執行，不能預先產生
  await connection();
  await connectDB();
  const session = await Session.findOne({ tokenHash: hashToken(token), expiresAt: { $gt: new Date() } }).lean();
  if (!session) return null;
  const user = await User.findById(session.userId, { email: 1 }).lean();
  return user ? { id: String(user._id), email: user.email } : null;
});

// 頁面用：沒登入就導到登入頁
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

// API 用：沒登入回 401
export const unauthorized = () => Response.json({ error: "請先登入" }, { status: 401 });
