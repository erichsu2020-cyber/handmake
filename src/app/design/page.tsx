"use client";

import Link from "next/link";
import { useState } from "react";
import {
  DEFAULT_DESIGN,
  DESIGN_BACKGROUNDS,
  DESIGN_LIGHTING,
  DESIGN_MATERIALS,
  DESIGN_QUALITIES,
  DESIGN_SIZES,
  DESIGN_STYLES,
  DESIGN_VIEWS,
  MAX_COLORS,
  MAX_COUNT,
  buildDesignPrompt,
  type DesignInput,
} from "@/lib/design-settings";
import type { DesignView } from "@/lib/designs";

const EXAMPLES = [
  { subject: "一隻戴著飛行員護目鏡的柴犬", details: "坐姿，尾巴捲起來，脖子上圍著紅色圍巾" },
  { subject: "迷你城堡造型的筆筒", details: "四座塔樓，中間是空心可以放筆" },
  { subject: "可愛的章魚手機架", details: "觸手往前伸出撐住手機，表情開心" },
];

export default function DesignPage() {
  const [design, setDesign] = useState<DesignInput>(DEFAULT_DESIGN);
  const [reference, setReference] = useState<File | null>(null);
  const [referencePreview, setReferencePreview] = useState<string | null>(null);
  const [result, setResult] = useState<DesignView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const set = <K extends keyof DesignInput>(key: K, value: DesignInput[K]) =>
    setDesign((prev) => ({ ...prev, [key]: value }));

  function handleReferenceChange(next: File | null) {
    if (referencePreview) URL.revokeObjectURL(referencePreview);
    setReference(next);
    setReferencePreview(next ? URL.createObjectURL(next) : null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!design.subject.trim()) {
      setError("請填寫主題");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    const formData = new FormData();
    formData.append("design", JSON.stringify(design));
    if (reference) formData.append("reference", reference);

    try {
      const res = await fetch("/api/designs", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "產生失敗");
      setResult(data.design);
    } catch (err) {
      setError(err instanceof Error ? err.message : "產生失敗");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-4 py-10">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-3xl font-semibold">設計 3D 圖</h1>
          <p className="mt-1 text-zinc-500">一步步填寫，規劃出你想要的 3D 模型外觀</p>
        </div>
        <Link href="/design/history" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          查看設計紀錄
        </Link>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <Section title="1. 主題與描述">
          <Field label="主題（必填）">
            <input
              value={design.subject}
              onChange={(e) => set("subject", e.target.value)}
              maxLength={200}
              placeholder="例如：一隻戴著飛行員護目鏡的柴犬"
              className="rounded-lg border border-zinc-300 bg-transparent p-2.5 dark:border-zinc-700"
            />
          </Field>
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="text-zinc-500">範例：</span>
            {EXAMPLES.map((example) => (
              <button
                key={example.subject}
                type="button"
                onClick={() => setDesign((prev) => ({ ...prev, ...example }))}
                className="text-zinc-600 underline dark:text-zinc-400"
              >
                {example.subject}
              </button>
            ))}
          </div>
          <Field label="細節描述" hint="姿勢、表情、配件、結構、尺寸比例…想到什麼都可以寫">
            <textarea
              value={design.details}
              onChange={(e) => set("details", e.target.value)}
              rows={3}
              maxLength={1000}
              className="rounded-lg border border-zinc-300 bg-transparent p-2.5 dark:border-zinc-700"
            />
          </Field>
          <Field label="參考圖片（選填）" hint="會以這張圖為基礎重新設計">
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => handleReferenceChange(e.target.files?.[0] ?? null)}
              className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-zinc-200 file:px-4 file:py-2 dark:file:bg-zinc-800"
            />
          </Field>
          {referencePreview && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={referencePreview} alt="參考圖片" className="max-h-48 w-fit rounded-lg" />
          )}
        </Section>

        <Section title="2. 外觀">
          <Field label="風格">
            <Chips options={DESIGN_STYLES} value={design.style} onChange={(v) => set("style", v)} />
          </Field>
          <Field label="材質">
            <Chips options={DESIGN_MATERIALS} value={design.material} onChange={(v) => set("material", v)} />
          </Field>
          <Field label={`主色（最多 ${MAX_COLORS} 個，可不選）`}>
            <div className="flex flex-wrap items-center gap-3">
              {design.colors.map((color, i) => (
                <div key={i} className="flex items-center gap-1">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) =>
                      set("colors", design.colors.map((c, j) => (j === i ? e.target.value : c)))
                    }
                    className="h-9 w-12 cursor-pointer rounded border border-zinc-300 bg-transparent dark:border-zinc-700"
                  />
                  <button
                    type="button"
                    aria-label="移除顏色"
                    onClick={() => set("colors", design.colors.filter((_, j) => j !== i))}
                    className="px-1 text-zinc-500"
                  >
                    ✕
                  </button>
                </div>
              ))}
              {design.colors.length < MAX_COLORS && (
                <button
                  type="button"
                  onClick={() => set("colors", [...design.colors, "#e07a5f"])}
                  className="rounded-full border border-dashed border-zinc-400 px-3 py-1.5 text-sm"
                >
                  ＋ 新增顏色
                </button>
              )}
            </div>
          </Field>
        </Section>

        <Section title="3. 鏡頭與場景">
          <Field label="視角">
            <Chips options={DESIGN_VIEWS} value={design.view} onChange={(v) => set("view", v)} />
          </Field>
          <Field label="光線">
            <Chips options={DESIGN_LIGHTING} value={design.lighting} onChange={(v) => set("lighting", v)} />
          </Field>
          <Field label="背景">
            <Chips options={DESIGN_BACKGROUNDS} value={design.background} onChange={(v) => set("background", v)} />
          </Field>
        </Section>

        <Section title="4. 3D 列印與限制">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={design.printFriendly}
              onChange={(e) => set("printFriendly", e.target.checked)}
              className="h-4 w-4"
            />
            <span>適合 3D 列印（單一實心物件、底部平穩、避免細小懸空的部分）</span>
          </label>
          <Field label="不要出現的東西（選填）">
            <input
              value={design.avoid}
              onChange={(e) => set("avoid", e.target.value)}
              maxLength={1000}
              placeholder="例如：武器、文字、底座"
              className="rounded-lg border border-zinc-300 bg-transparent p-2.5 dark:border-zinc-700"
            />
          </Field>
        </Section>

        <Section title="5. 輸出">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="圖片比例">
              <Select
                value={design.size}
                options={DESIGN_SIZES}
                onChange={(v) => set("size", v as DesignInput["size"])}
              />
            </Field>
            <Field label="品質">
              <Select
                value={design.quality}
                options={DESIGN_QUALITIES}
                onChange={(v) => set("quality", v as DesignInput["quality"])}
              />
            </Field>
            <Field label="張數" hint="張數越多，費用越高">
              <Select
                value={String(design.count)}
                options={Array.from({ length: MAX_COUNT }, (_, i) => ({
                  value: String(i + 1),
                  label: `${i + 1} 張`,
                }))}
                onChange={(v) => set("count", Number(v))}
              />
            </Field>
          </div>
        </Section>

        <details className="rounded-lg border border-zinc-300 p-4 text-sm dark:border-zinc-700">
          <summary className="cursor-pointer font-medium">查看送給 AI 的提示詞</summary>
          <p className="mt-3 whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">
            {design.subject.trim() ? buildDesignPrompt(design, Boolean(reference)) : "請先填寫主題"}
          </p>
        </details>

        <button
          type="submit"
          disabled={loading}
          className="h-12 rounded-full bg-foreground px-6 font-medium text-background transition-opacity disabled:opacity-50"
        >
          {loading ? `產生中…（${design.count} 張，約需 30–90 秒）` : "產生 3D 設計圖"}
        </button>
      </form>

      {error && <p className="rounded-lg bg-red-100 p-3 text-red-700">{error}</p>}

      {result && (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold">設計結果</h2>
          <div className={`grid gap-4 ${result.imageUrls.length > 1 ? "sm:grid-cols-2" : ""}`}>
            {result.imageUrls.map((url, i) => (
              <figure key={url} className="flex flex-col gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`設計圖 ${i + 1}`} className="w-full rounded-lg" />
                <a href={url} download className="text-center text-sm underline">
                  下載第 {i + 1} 張
                </a>
              </figure>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
      <legend className="px-1 font-medium">{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="text-sm text-zinc-500">{hint}</span>}
    </label>
  );
}

function Chips({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-full border px-3.5 py-1.5 text-sm ${
            value === option.value
              ? "border-foreground bg-foreground text-background"
              : "border-zinc-300 dark:border-zinc-700"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
