import { connectDB } from "@/lib/mongodb";
import type { DesignInput } from "@/lib/design-settings";
import { DesignImage } from "@/models/DesignImage";

// 「設計 3D 圖」前端看到的資料格式

export type DesignView = DesignInput & {
  id: string;
  prompt: string;
  referenceImageUrl?: string;
  imageUrls: string[];
  createdAt: string;
};

/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- lean() 與 toObject() 的型別不同，這裡統一轉換 */
export function toDesignView(doc: any): DesignView {
  return {
    id: doc._id.toString(),
    subject: doc.subject,
    details: doc.details ?? "",
    style: doc.style,
    material: doc.material,
    colors: doc.colors ?? [],
    view: doc.view,
    lighting: doc.lighting,
    background: doc.background,
    printFriendly: doc.printFriendly,
    avoid: doc.avoid ?? "",
    size: doc.size,
    quality: doc.quality,
    count: doc.count,
    prompt: doc.prompt,
    referenceImageUrl: doc.referenceImageUrl,
    imageUrls: (doc.images ?? []).map((image: { url: string }) => image.url),
    createdAt: new Date(doc.createdAt).toISOString(),
  };
}

export async function listDesigns(limit = 50) {
  await connectDB();
  const docs = await DesignImage.find().sort({ createdAt: -1 }).limit(limit).lean();
  return docs.map(toDesignView);
}
