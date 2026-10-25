"use client";

import { useState } from "react";
import {
  DEFAULT_SLICE,
  LAYER_HEIGHTS,
  PRINT_MATERIALS,
  SUPPORT_OPTIONS,
  estimatePrint,
  sliceSummary,
  type MeshStats,
  type SliceSettings,
} from "@/lib/print-estimate";

const STORAGE_KEY = "handmake.slice-settings";

// 記住上次的切片參數（只存在這台電腦的瀏覽器）
function loadSaved(): SliceSettings {
  try {
    const saved = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
    return saved ? { ...DEFAULT_SLICE, ...JSON.parse(saved) } : DEFAULT_SLICE;
  } catch {
    return DEFAULT_SLICE;
  }
}

export default function PrintEstimatePanel({ stats, heightMm }: { stats: MeshStats; heightMm: number }) {
  const [slice, setSlice] = useState<SliceSettings>(loadSaved);
  const [copied, setCopied] = useState(false);

  const material = PRINT_MATERIALS.find((m) => m.value === slice.material) ?? PRINT_MATERIALS[0];
  const isResin = material.kind === "resin";
  const estimate = estimatePrint(stats, heightMm, slice);

  function update(next: Partial<SliceSettings>) {
    setSlice((prev) => {
      const merged = { ...prev, ...next };
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      } catch {}
      return merged;
    });
  }

  function changeMaterial(value: SliceSettings["material"]) {
    const next = PRINT_MATERIALS.find((m) => m.value === value)!;
    const layers = LAYER_HEIGHTS[next.kind];
    update({
      material: value,
      pricePerKg: next.pricePerKg,
      layerHeight: layers.includes(slice.layerHeight) ? slice.layerHeight : layers[Math.floor(layers.length / 2)],
    });
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(sliceSummary(slice));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  return (
    <fieldset className="flex flex-col gap-4 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
      <legend className="px-1 font-medium">列印材料與切片參數（粗估）</legend>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">列印耗材</span>
          <select
            value={slice.material}
            onChange={(e) => changeMaterial(e.target.value as SliceSettings["material"])}
            className="rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
          >
            {PRINT_MATERIALS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">層高</span>
          <select
            value={slice.layerHeight}
            onChange={(e) => update({ layerHeight: Number(e.target.value) })}
            className="rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
          >
            {LAYER_HEIGHTS[material.kind].map((h) => (
              <option key={h} value={h}>
                {h} mm{h === 0.2 || h === 0.05 ? "（建議）" : ""}
              </option>
            ))}
          </select>
        </label>

        {!isResin && (
          <>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">填充密度：{slice.infillPercent}%</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={slice.infillPercent}
                onChange={(e) => update({ infillPercent: Number(e.target.value) })}
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">牆壁圈數（壁厚）</span>
              <select
                value={slice.wallLoops}
                onChange={(e) => update({ wallLoops: Number(e.target.value) })}
                className="rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
              >
                {[1, 2, 3, 4, 5, 6].map((n) => (
                  <option key={n} value={n}>
                    {n} 圈（約 {(n * 0.42).toFixed(2)} mm）
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">支撐</span>
          <select
            value={slice.support}
            onChange={(e) => update({ support: e.target.value as SliceSettings["support"] })}
            className="rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
          >
            {SUPPORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">耗材價格（元／公斤）</span>
          <input
            type="number"
            min={0}
            value={slice.pricePerKg}
            onChange={(e) => update({ pricePerKg: Math.max(0, Number(e.target.value)) })}
            className="rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
          />
        </label>
      </div>

      <dl className="grid grid-cols-3 gap-3 rounded-lg bg-zinc-100 p-3 text-center dark:bg-zinc-900">
        <div>
          <dt className="text-xs text-zinc-500">用料</dt>
          <dd className="text-lg font-semibold">{estimate.grams.toFixed(0)} g</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">耗材費用</dt>
          <dd className="text-lg font-semibold">約 {Math.round(estimate.cost)} 元</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-500">列印時間</dt>
          <dd className="text-lg font-semibold">
            約 {estimate.hours < 1 ? `${Math.max(1, Math.round(estimate.hours * 60))} 分` : `${estimate.hours.toFixed(1)} 小時`}
          </dd>
        </div>
      </dl>

      <ul className="text-sm text-zinc-600 dark:text-zinc-400">
        <li>
          模型體積 {(stats.volumeMm3 / 1000).toFixed(1)} cm³，懸空面積約佔 {(estimate.overhangRatio * 100).toFixed(0)}%
          {estimate.supportRecommended
            ? slice.support === "none"
              ? "，⚠️ 建議加支撐"
              : `，支撐約 ${estimate.supportGrams.toFixed(0)} g`
            : "，懸空不多，可以不加支撐"}
        </li>
        <li>這是粗估，實際用料與時間以切片軟體的結果為準</li>
      </ul>

      <button
        type="button"
        onClick={copySummary}
        className="self-start rounded-full border border-zinc-300 px-4 py-1.5 text-sm dark:border-zinc-700"
      >
        {copied ? "已複製 ✓" : "複製切片設定（貼到 Bambu Studio／Cura 參考）"}
      </button>
    </fieldset>
  );
}
