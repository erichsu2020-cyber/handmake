"use client";

import { useState } from "react";

type Model3d = {
  status: "generating" | "converting" | "uploading" | "done" | "failed";
  progress: number;
  stlUrl?: string;
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
      const res = await fetch(url, { method: "POST" });
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

          <button
            type="button"
            onClick={handleCreateModel}
            disabled={modelBusy || model3d?.status === "done"}
            className="h-12 rounded-full bg-foreground px-6 font-medium text-background transition-opacity disabled:opacity-50"
          >
            {model3d?.status === "failed" ? "重試第 2 步" : "第 2 步：轉成 STL（約需 1–3 分鐘）"}
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
