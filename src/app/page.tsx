"use client";

import { useState } from "react";
import { FACE_LIMIT, HEIGHT_MM } from "@/lib/print-settings";

type Model3d = {
  status: "generating" | "converting" | "uploading" | "done" | "failed";
  progress: number;
  heightMm: number;
  faceLimit: number;
  stlUrl?: string;
  dimensionsMm?: [number, number, number];
  triangles?: number;
  fileSizeBytes?: number;
  error?: string;
};

const STATUS_TEXT: Record<Model3d["status"], string> = {
  generating: "Tripo3D 產生 3D 模型中",
  converting: "轉換成 STL 中",
  uploading: "上傳 STL 中",
  done: "完成",
  failed: "失敗",
};

const POLL_INTERVAL_MS = 3000;

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; imageUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [model3d, setModel3d] = useState<Model3d | null>(null);
  const [heightMm, setHeightMm] = useState(HEIGHT_MM.default);
  const [faceLimit, setFaceLimit] = useState(FACE_LIMIT.default);

  function handleFileChange(next: File | null) {
    if (preview) URL.revokeObjectURL(preview);
    setFile(next);
    setPreview(next ? URL.createObjectURL(next) : null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!prompt.trim() && !file) {
      setError("請輸入文字或上傳一張圖片");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    setModel3d(null);

    const formData = new FormData();
    formData.append("prompt", prompt);
    if (file) formData.append("image", file);

    try {
      const res = await fetch("/api/generate", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "產生失敗");
      setResult({ id: data.id, imageUrl: data.imageUrl });
    } catch (err) {
      setError(err instanceof Error ? err.message : "產生失敗");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateModel() {
    if (!result) return;
    setError(null);
    const url = `/api/generations/${result.id}/model3d`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ heightMm, faceLimit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "建立 3D 模型失敗");
      setModel3d(data.model3d);

      // 輪詢進度，直到完成或失敗
      let current: Model3d = data.model3d;
      while (current.status !== "done" && current.status !== "failed") {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const pollRes = await fetch(url);
        const pollData = await pollRes.json();
        if (!pollRes.ok) throw new Error(pollData.error ?? "查詢進度失敗");
        current = pollData.model3d;
        setModel3d(current);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立 3D 模型失敗");
    }
  }

  const modelBusy = model3d !== null && model3d.status !== "done" && model3d.status !== "failed";

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12">
      <h1 className="text-3xl font-semibold">Handmake 3D 產生器</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="font-medium">文字描述</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="例如：一隻戴著帽子的木雕小貓"
            className="rounded-lg border border-zinc-300 bg-transparent p-3 dark:border-zinc-700"
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="font-medium">上傳圖片（選填）</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-zinc-200 file:px-4 file:py-2 dark:file:bg-zinc-800"
          />
        </label>

        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="上傳的圖片" className="max-h-64 w-fit rounded-lg" />
        )}

        <button
          type="submit"
          disabled={loading || modelBusy}
          className="h-12 rounded-full bg-foreground px-6 font-medium text-background transition-opacity disabled:opacity-50"
        >
          {loading ? "產生中…（約需 30–60 秒）" : "第 1 步：產生 3D 模型圖"}
        </button>
      </form>

      {error && <p className="rounded-lg bg-red-100 p-3 text-red-700">{error}</p>}

      {result && (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">3D 模型圖</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={result.imageUrl} alt="產生的 3D 模型圖" className="w-full rounded-lg" />

          <fieldset
            disabled={modelBusy}
            className="flex flex-col gap-4 rounded-lg border border-zinc-300 p-4 disabled:opacity-50 dark:border-zinc-700"
          >
            <legend className="px-1 font-medium">列印設定</legend>

            <label className="flex flex-col gap-2">
              <span>
                模型高度（mm，{HEIGHT_MM.min}–{HEIGHT_MM.max}）
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  min={HEIGHT_MM.min}
                  max={HEIGHT_MM.max}
                  value={heightMm}
                  onChange={(e) => setHeightMm(Number(e.target.value))}
                  className="w-28 rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
                />
                {HEIGHT_MM.presets.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setHeightMm(preset)}
                    className={`rounded-full border px-3 py-1 text-sm ${
                      heightMm === preset
                        ? "border-foreground bg-foreground text-background"
                        : "border-zinc-300 dark:border-zinc-700"
                    }`}
                  >
                    {preset} mm
                  </button>
                ))}
              </div>
              <span className="text-sm text-zinc-500">寬度與深度會依比例自動計算</span>
            </label>

            <label className="flex flex-col gap-2">
              <span>面數</span>
              <select
                value={faceLimit}
                onChange={(e) => setFaceLimit(Number(e.target.value))}
                className="rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
              >
                {FACE_LIMIT.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </fieldset>

          <button
            type="button"
            onClick={handleCreateModel}
            disabled={modelBusy}
            className="h-12 rounded-full bg-foreground px-6 font-medium text-background transition-opacity disabled:opacity-50"
          >
            {model3d?.status === "done"
              ? "用新設定重新轉檔"
              : model3d?.status === "failed"
                ? "重試第 2 步"
                : "第 2 步：轉成 STL（約需 1–3 分鐘）"}
          </button>

          {model3d && (
            <div className="flex flex-col gap-2">
              <p>
                {STATUS_TEXT[model3d.status]}
                {modelBusy && `…（${model3d.progress}%）`}
              </p>
              {modelBusy && (
                <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
                  <div
                    className="h-full bg-foreground transition-all"
                    style={{ width: `${model3d.progress}%` }}
                  />
                </div>
              )}
              {model3d.status === "failed" && (
                <p className="rounded-lg bg-red-100 p-3 text-red-700">{model3d.error}</p>
              )}
              {model3d.status === "done" && model3d.dimensionsMm && (
                <ul className="text-sm text-zinc-600 dark:text-zinc-400">
                  <li>
                    尺寸：寬 {model3d.dimensionsMm[0]} × 深 {model3d.dimensionsMm[1]} × 高{" "}
                    {model3d.dimensionsMm[2]} mm
                  </li>
                  <li>面數：{model3d.triangles?.toLocaleString()}</li>
                  <li>檔案大小：{((model3d.fileSizeBytes ?? 0) / 1024 / 1024).toFixed(1)} MB</li>
                </ul>
              )}
              {model3d.status === "done" && model3d.stlUrl && (
                <a
                  href={model3d.stlUrl}
                  download
                  className="flex h-12 items-center justify-center rounded-full border border-zinc-300 font-medium dark:border-zinc-700"
                >
                  下載 STL 檔
                </a>
              )}
            </div>
          )}
        </section>
      )}
    </main>
  );
}
