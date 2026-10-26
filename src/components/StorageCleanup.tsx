"use client";

import { useState } from "react";

type Preview = {
  totalFiles: number;
  totalBytes: number;
  orphanFiles: number;
  orphanBytes: number;
  byFolder: Record<string, { files: number; bytes: number }>;
};

const FOLDER_LABEL: Record<string, string> = {
  "handmake/inputs": "上傳的原圖",
  "handmake/outputs": "3D 模型圖",
  "handmake/models": "3D 列印檔（舊版本）",
  "handmake/models/raw": "Tripo 原始檔（舊版本）",
  "handmake/designs/images": "設計圖",
  "handmake/designs/references": "設計參考圖",
  "handmake/drawings": "畫作",
  "handmake/models/bambu": "Bambu 設定檔（舊版本）",
  "handmake/bambu/models": "上傳的模型",
  "handmake/bambu/uploads": "上傳到一半的模型",
};

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// 清理 Vercel Blob 上沒有任何紀錄在用的檔案：先檢查、確認後才刪除
export default function StorageCleanup() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [state, setState] = useState<"idle" | "checking" | "deleting">("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function check() {
    setState("checking");
    setMessage(null);
    try {
      const res = await fetch("/api/blob-cleanup");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "檢查失敗");
      setPreview(data);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "檢查失敗");
    } finally {
      setState("idle");
    }
  }

  async function cleanup() {
    if (!preview || !window.confirm(`確定要刪除 ${preview.orphanFiles} 個沒有用到的檔案（${mb(preview.orphanBytes)}）嗎？`)) return;
    setState("deleting");
    try {
      const res = await fetch("/api/blob-cleanup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "清理失敗");
      setMessage(`已刪除 ${data.deletedFiles} 個檔案，釋放 ${mb(data.deletedBytes)}`);
      setPreview(null);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "清理失敗");
    } finally {
      setState("idle");
    }
  }

  return (
    <details className="rounded-lg border border-zinc-300 p-4 text-sm dark:border-zinc-700">
      <summary className="cursor-pointer font-medium">清理儲存空間</summary>
      <div className="mt-3 flex flex-col gap-3">
        <p className="text-zinc-500">
          找出 Vercel Blob 上沒有任何紀錄在用的檔案（例如重新轉檔前的舊版本），確認後再刪除。一小時內上傳的檔案不會被刪。
        </p>

        {preview && (
          <div className="flex flex-col gap-1">
            <p>
              目前共 {preview.totalFiles} 個檔案（{mb(preview.totalBytes)}），其中{" "}
              <strong>{preview.orphanFiles} 個沒有用到（{mb(preview.orphanBytes)}）</strong>
            </p>
            {Object.entries(preview.byFolder).map(([folder, info]) => (
              <p key={folder} className="text-zinc-500">
                ・{FOLDER_LABEL[folder] ?? folder}：{info.files} 個，{mb(info.bytes)}
              </p>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={check}
            disabled={state !== "idle"}
            className="rounded-full border border-zinc-300 px-4 py-1.5 disabled:opacity-50 dark:border-zinc-700"
          >
            {state === "checking" ? "檢查中…" : "檢查"}
          </button>
          {preview && preview.orphanFiles > 0 && (
            <button
              type="button"
              onClick={cleanup}
              disabled={state !== "idle"}
              className="rounded-full border border-red-300 px-4 py-1.5 text-red-600 disabled:opacity-50"
            >
              {state === "deleting" ? "刪除中…" : `刪除 ${preview.orphanFiles} 個沒用到的檔案`}
            </button>
          )}
        </div>

        {message && <p>{message}</p>}
      </div>
    </details>
  );
}
