"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { downloadUrl } from "@/lib/blob-url";

// 歷史紀錄／設計紀錄卡片下方的下載與刪除按鈕
export default function HistoryActions({
  deleteApi,
  downloads,
  busy = false,
  className = "px-3 pb-3",
}: {
  deleteApi: string;
  downloads: { label: string; url: string }[];
  busy?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!window.confirm("確定要刪除這筆紀錄嗎？相關的圖片和檔案會一起刪除，無法復原。")) return;

    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(deleteApi, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "刪除失敗");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "刪除失敗");
      setDeleting(false);
    }
  }

  const button = "rounded-full border border-zinc-300 px-3 py-1 text-xs dark:border-zinc-700";

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="flex flex-wrap gap-1.5">
        {downloads.map((d) => (
          <a key={d.url} href={downloadUrl(d.url)} className={button}>
            {d.label}
          </a>
        ))}
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting || busy}
          title={busy ? "正在轉 3D，完成後才能刪除" : undefined}
          className={`${button} text-red-600 disabled:opacity-50`}
        >
          {deleting ? "刪除中…" : "刪除"}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
