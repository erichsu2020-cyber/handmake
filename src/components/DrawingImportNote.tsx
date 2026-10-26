import type { useDrawingImport } from "@/lib/use-drawing-import";

// 設計頁、建立頁帶入畫作時的狀態說明
export default function DrawingImportNote({
  state,
  hasFile,
  label,
}: {
  state: ReturnType<typeof useDrawingImport>;
  hasFile: boolean;
  label: string;
}) {
  if (state.status === "loading") return <p className="text-sm text-zinc-500">正在帶入畫作…</p>;
  if (state.status === "error") {
    return <p className="rounded-lg bg-red-100 p-3 text-sm text-red-700">帶入畫作失敗：{state.error}</p>;
  }
  // 使用者之後自己換掉或清掉圖片，就不再顯示
  if (state.status === "done" && hasFile) {
    return <p className="text-sm text-zinc-500">已帶入畫作「{state.title}」當作{label}，也可以重新選擇其他圖片。</p>;
  }
  return null;
}
