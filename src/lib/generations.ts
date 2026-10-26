import { isValidObjectId } from "mongoose";
import { connectDB } from "@/lib/mongodb";
import { toGenerationView } from "@/lib/generation-view";
import { Generation } from "@/models/Generation";

// 頁面與 API 共用的查詢。只撈需要的欄位：早期資料把整張圖片存成 Buffer，
// 全部撈回來會讓列表變得非常慢
const PROJECTION = {
  mode: 1,
  prompt: 1,
  style: 1,
  inputImageUrl: 1,
  outputImageUrl: 1,
  createdAt: 1,
  model3d: 1,
  bambu: 1,
};

// 一律帶 userId：只查得到該帳號自己的紀錄
export async function listGenerations(userId: string, limit = 50) {
  await connectDB();
  const docs = await Generation.find({ userId }, PROJECTION).sort({ createdAt: -1 }).limit(limit).lean();
  return docs.map(toGenerationView);
}

// Bambu 設定頁：只列出已完成的 3MF
export async function listBambuModels(userId: string, limit = 50) {
  await connectDB();
  const docs = await Generation.find({ userId, "model3d.status": "done", "model3d.format": "3MF" }, PROJECTION)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  return docs.map(toGenerationView);
}

export async function getGeneration(id: string, userId: string) {
  if (!isValidObjectId(id)) return null;
  await connectDB();
  const doc = await Generation.findOne({ _id: id, userId }, PROJECTION).lean();
  return doc ? toGenerationView(doc) : null;
}
