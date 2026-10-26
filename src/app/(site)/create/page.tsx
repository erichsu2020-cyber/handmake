"use client";

import { useState } from "react";
import { upload } from "@vercel/blob/client";
import ModelPanel from "@/components/ModelPanel";
import type { GenerationView } from "@/lib/generation-view";
import {
  DEFAULT_IMAGE_QUALITY,
  DEFAULT_STYLE,
  IMAGE_QUALITIES,
  STYLE_PRESETS,
  type ImageQuality,
  type StylePreset,
} from "@/lib/image-settings";

export default function CreatePage() {
  const [prompt, setPrompt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [style, setStyle] = useState<StylePreset>(DEFAULT_STYLE);
  const [quality, setQuality] = useState<ImageQuality>(DEFAULT_IMAGE_QUALITY);
  const [result, setResult] = useState<GenerationView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

    try {
      // 原圖直接從瀏覽器上傳到 Vercel Blob，不經過伺服器（Vercel 函式的請求上限只有 4.5MB）
      let imageUrl: string | null = null;
      if (file) {
        try {
          const blob = await upload(`handmake/inputs/upload.${file.type.split("/")[1]}`, file, {
            access: "public",
            handleUploadUrl: "/api/blob-upload",
            contentType: file.type,
          });
          imageUrl = blob.url;
        } catch (err) {
          throw new Error(err instanceof Error ? `上傳原圖失敗：${err.message}` : "上傳原圖失敗");
        }
      }

      const formData = new FormData();
      formData.append("prompt", prompt);
      formData.append("style", style);
      formData.append("quality", quality);
      if (imageUrl) formData.append("imageUrl", imageUrl);

      const res = await fetch("/api/generate", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "產生失敗");
      setResult(data.generation);
    } catch (err) {
      setError(err instanceof Error ? err.message : "產生失敗");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-10">
      <h1 className="text-3xl font-semibold">Handmake 3D 產生器</h1>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2">
          <span className="font-medium">文字描述</span>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            placeholder="例如：一隻戴著帽子的小貓"
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

        <div className="flex flex-col gap-2">
          <span className="font-medium">風格</span>
          <div className="flex flex-wrap gap-2">
            {STYLE_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => setStyle(preset.value)}
                className={`rounded-full border px-4 py-1.5 text-sm ${
                  style === preset.value
                    ? "border-foreground bg-foreground text-background"
                    : "border-zinc-300 dark:border-zinc-700"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-2">
          <span className="font-medium">圖片品質</span>
          <select
            value={quality}
            onChange={(e) => setQuality(e.target.value as ImageQuality)}
            className="rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
          >
            {IMAGE_QUALITIES.map((q) => (
              <option key={q.value} value={q.value}>
                {q.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          disabled={loading}
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
          <img src={result.outputImageUrl} alt="產生的 3D 模型圖" className="w-full rounded-lg" />
        </section>
      )}

      {/* 第 2 步的設定一開始就顯示，可以先選好；第 1 步完成後才能送出 */}
      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">第 2 步：轉成 3D 列印檔</h2>
        {!result && (
          <p className="text-sm text-zinc-500">可以先選好下面的設定，完成第 1 步後再按產生。</p>
        )}
        <ModelPanel generationId={result?.id} />
      </section>
    </main>
  );
}
