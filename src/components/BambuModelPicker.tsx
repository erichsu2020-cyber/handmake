"use client";

import { useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { BAMBU_UPLOAD_FOLDER, BAMBU_UPLOAD_TYPES, MAX_BAMBU_UPLOAD_BYTES } from "@/lib/bambu-settings";
import type { BambuUploadView, BambuView, GenerationView } from "@/lib/generation-view";

// Bambu 設定頁可以選的模型：網站上產生的 3MF，或從電腦上傳的 STL／3MF，統一成同一種格式
export type BambuModel = {
  key: string; // "generation:<id>" 或 "upload:<id>"
  kind: "generation" | "upload";
  name: string;
  imageUrl?: string; // 網站上的模型才有 3D 模型圖
  fileUrl: string; // 要寫入設定的 3MF
  dimensionsMm?: number[];
  createdAt: string;
  bambu?: BambuView;
  bambuApi: string;
};

export const fromGeneration = (g: GenerationView): BambuModel => ({
  key: `generation:${g.id}`,
  kind: "generation",
  name: g.prompt || (g.mode === "image" ? "（上傳圖片）" : "（無描述）"),
  imageUrl: g.outputImageUrl,
  fileUrl: g.model3d?.fileUrl ?? "",
  dimensionsMm: g.model3d?.dimensionsMm,
  createdAt: g.createdAt,
  bambu: g.bambu,
  bambuApi: `/api/generations/${g.id}/bambu`,
});

export const fromUpload = (u: BambuUploadView): BambuModel => ({
  key: `upload:${u.id}`,
  kind: "upload",
  name: u.name,
  fileUrl: u.modelFileUrl,
  dimensionsMm: u.dimensionsMm,
  createdAt: u.createdAt,
  bambu: u.bambu,
  bambuApi: `/api/bambu-uploads/${u.id}/bambu`,
});

const formatDate = (iso: string) => new Date(iso).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" });
const formatSize = (dims?: number[]) => (dims ? `${dims.map((v) => Math.round(v)).join("×")} mm` : "");

export default function BambuModelPicker({
  open,
  onClose,
  generations,
  uploads,
  selectedKey,
  onSelect,
  onUploaded,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  generations: BambuModel[];
  uploads: BambuModel[];
  selectedKey: string | null;
  onSelect: (model: BambuModel) => void;
  onUploaded: (upload: BambuUploadView) => void;
  onDeleted: (key: string) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<"site" | "upload">(generations.length > 0 ? "site" : "upload");
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 用瀏覽器內建的 <dialog>：有遮罩、按 Esc 會關閉
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    const ext = file.name.toLowerCase().split(".").pop() as keyof typeof BAMBU_UPLOAD_TYPES;
    if (!(ext in BAMBU_UPLOAD_TYPES)) {
      setError("只支援 STL 和 3MF 檔");
      return;
    }
    if (file.size > MAX_BAMBU_UPLOAD_BYTES) {
      setError(`檔案不能超過 ${MAX_BAMBU_UPLOAD_BYTES / 1024 / 1024}MB`);
      return;
    }

    setUploading(true);
    try {
      // 檔案直接從瀏覽器上傳到 Vercel Blob，不經過伺服器（Vercel 函式的請求上限只有 4.5MB）
      const blob = await upload(`${BAMBU_UPLOAD_FOLDER}model.${ext}`, file, {
        access: "public",
        handleUploadUrl: "/api/blob-upload",
        contentType: BAMBU_UPLOAD_TYPES[ext],
      });
      // 伺服器讀取模型、整理成 3MF、建立紀錄
      const res = await fetch("/api/bambu-uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: blob.url, name: file.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "匯入模型失敗");
      onUploaded(data.upload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上傳失敗");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleDelete(model: BambuModel) {
    if (!window.confirm(`確定要刪除「${model.name}」嗎？上傳的模型和 Bambu 檔會一起刪除，無法復原。`)) return;
    setDeletingKey(model.key);
    setError(null);
    try {
      const res = await fetch(`/api/bambu-uploads/${model.key.split(":")[1]}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "刪除失敗");
      onDeleted(model.key);
    } catch (err) {
      setError(err instanceof Error ? err.message : "刪除失敗");
    } finally {
      setDeletingKey(null);
    }
  }

  const tabClass = (active: boolean) =>
    `rounded-full px-4 py-1.5 text-sm ${active ? "bg-foreground text-background" : "text-zinc-500 hover:text-foreground"}`;

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      // 點遮罩（dialog 本身，不是裡面的內容）也關閉
      onClick={(e) => e.target === dialogRef.current && onClose()}
      className="m-auto w-[calc(100%-2rem)] max-w-3xl rounded-xl bg-background p-0 text-foreground backdrop:bg-black/50"
    >
      <div className="flex max-h-[85vh] flex-col gap-4 p-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold">開啟檔案</h2>
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-sm text-zinc-500 hover:text-foreground">
            關閉
          </button>
        </div>

        <div className="flex gap-2">
          <button type="button" className={tabClass(tab === "site")} onClick={() => setTab("site")}>
            網站上的模型（{generations.length}）
          </button>
          <button type="button" className={tabClass(tab === "upload")} onClick={() => setTab("upload")}>
            從電腦上傳（{uploads.length}）
          </button>
        </div>

        {error && <p className="rounded-lg bg-red-100 p-3 text-sm text-red-700">{error}</p>}

        <div className="overflow-y-auto">
          {tab === "site" &&
            (generations.length === 0 ? (
              <p className="text-sm text-zinc-500">
                還沒有完成的 3MF 模型。到「製作模型」的第 2 步把檔案格式選成 3MF，完成後就會出現在這裡。
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {generations.map((m) => (
                  <li key={m.key}>
                    <button
                      type="button"
                      onClick={() => onSelect(m)}
                      className={`flex w-full flex-col overflow-hidden rounded-lg border text-left text-xs ${
                        m.key === selectedKey ? "border-foreground ring-2 ring-foreground" : "border-zinc-300 dark:border-zinc-700"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={m.imageUrl} alt="" className="aspect-square w-full bg-white object-contain" />
                      <span className="flex flex-col gap-0.5 p-2">
                        <span className="line-clamp-1">{m.name}</span>
                        <span className="text-zinc-500">{formatSize(m.dimensionsMm)}</span>
                        <BambuBadge bambu={m.bambu} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ))}

          {tab === "upload" && (
            <div className="flex flex-col gap-4">
              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  if (!uploading) handleFile(e.dataTransfer.files[0]);
                }}
                className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-8 text-center ${
                  dragging ? "border-foreground bg-foreground/5" : "border-zinc-300 dark:border-zinc-700"
                } ${uploading ? "pointer-events-none opacity-50" : ""}`}
              >
                <span className="font-medium">{uploading ? "上傳並讀取模型中…" : "選擇檔案，或拖曳到這裡"}</span>
                <span className="text-sm text-zinc-500">
                  STL 或 3MF，{MAX_BAMBU_UPLOAD_BYTES / 1024 / 1024}MB 以內。多零件的 3MF 會忽略零件各自的位置，零件可能會疊在一起
                </span>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".stl,.3mf"
                  disabled={uploading}
                  onChange={(e) => handleFile(e.target.files?.[0])}
                  className="sr-only"
                />
              </label>

              {uploads.length > 0 && (
                <ul className="flex flex-col divide-y divide-zinc-200 rounded-lg border border-zinc-300 dark:divide-zinc-800 dark:border-zinc-700">
                  {uploads.map((m) => (
                    <li
                      key={m.key}
                      className={`flex items-center gap-3 p-3 text-sm ${m.key === selectedKey ? "bg-foreground/5" : ""}`}
                    >
                      <button type="button" onClick={() => onSelect(m)} className="flex flex-1 flex-col gap-0.5 text-left">
                        <span className="line-clamp-1 font-medium">{m.name}</span>
                        <span className="text-zinc-500">
                          {formatSize(m.dimensionsMm)}・{formatDate(m.createdAt)}
                        </span>
                        <BambuBadge bambu={m.bambu} />
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelect(m)}
                        className="rounded-full border border-foreground px-3 py-1 text-xs"
                      >
                        選擇
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(m)}
                        disabled={deletingKey === m.key}
                        className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-red-600 disabled:opacity-50 dark:border-zinc-700"
                      >
                        {deletingKey === m.key ? "刪除中…" : "刪除"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}

function BambuBadge({ bambu }: { bambu?: BambuView }) {
  if (!bambu) return null;
  return (
    <span className={bambu.outdated ? "text-amber-600" : "text-zinc-500"}>
      {bambu.outdated ? "Bambu 檔需更新" : "已有 Bambu 檔"}
    </span>
  );
}
