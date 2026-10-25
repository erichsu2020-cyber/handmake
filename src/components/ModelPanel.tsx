"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Model3dView } from "@/lib/generation-view";
import {
  DEFAULT_SETTINGS,
  FACE_LIMIT,
  FORMATS,
  HEIGHT_MM,
  MODEL_VERSIONS,
  isP1,
  sameGenerateOptions,
  type ModelSettings,
} from "@/lib/print-settings";

// three.js 只能在瀏覽器執行
const ModelPreview = dynamic(() => import("@/components/ModelPreview"), { ssr: false });

const STATUS_TEXT: Record<Model3dView["status"], string> = {
  generating: "Tripo3D 產生 3D 模型中",
  converting: "轉檔中",
  uploading: "縮放並上傳檔案中",
  done: "完成",
  failed: "失敗",
};

const POLL_INTERVAL_MS = 3000;

const isBusy = (m: Model3dView | null | undefined) =>
  !!m && m.status !== "done" && m.status !== "failed";

// 從上一次的結果帶入設定，沒有的欄位用預設值
function settingsFrom(model3d?: Model3dView): ModelSettings {
  const s = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(s) as (keyof ModelSettings)[]) {
    if (model3d?.[key] !== undefined) Object.assign(s, { [key]: model3d[key] });
  }
  return s;
}

export default function ModelPanel({
  generationId,
  initialModel3d,
}: {
  generationId: string;
  initialModel3d?: Model3dView;
}) {
  const [model3d, setModel3d] = useState<Model3dView | null>(initialModel3d ?? null);
  const [settings, setSettings] = useState<ModelSettings>(() => settingsFrom(initialModel3d));
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef(false);
  const url = `/api/generations/${generationId}/model3d`;

  const set = <K extends keyof ModelSettings>(key: K, value: ModelSettings[K]) =>
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      // 互斥規則：彩色只有 OBJ 能保留；彩色不能拆零件；P1 不支援拆零件與精細幾何
      if (key === "color" && value) Object.assign(next, { format: "OBJ", generateParts: false });
      if (key === "generateParts" && value) next.color = false;
      if (key === "format" && value !== "OBJ") next.color = false;
      if (key === "modelVersion" && isP1(value as string)) {
        Object.assign(next, { generateParts: false, geometryQuality: "standard" });
      }
      return next;
    });

  const poll = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        const res = await fetch(url);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "查詢進度失敗");
        setModel3d(data.model3d);
        if (!isBusy(data.model3d)) break;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "查詢進度失敗");
    } finally {
      pollingRef.current = false;
    }
  }, [url]);

  // 從歷史紀錄打開還在處理中的資料時，接著輪詢
  useEffect(() => {
    if (!isBusy(initialModel3d)) return;
    const timer = setTimeout(poll, 0);
    return () => clearTimeout(timer);
  }, [initialModel3d, poll]);

  async function handleStart() {
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "建立 3D 模型失敗");
      setModel3d(data.model3d);
      if (isBusy(data.model3d)) await poll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立 3D 模型失敗");
    }
  }

  const busy = isBusy(model3d);
  const p1 = isP1(settings.modelVersion);
  // 跟後端同一個判斷：之前的模型產生成功過（有轉檔任務）且產生設定沒變 → 只要重新轉檔
  const onlyReconvert = !!model3d?.convertTaskId && sameGenerateOptions(model3d, settings);

  return (
    <div className="flex flex-col gap-4">
      <fieldset
        disabled={busy}
        className="flex flex-col gap-5 rounded-lg border border-zinc-300 p-4 disabled:opacity-50 dark:border-zinc-700"
      >
        <legend className="px-1 font-medium">3D 模型設定</legend>

        <Field label="模型版本">
          <Select
            value={settings.modelVersion}
            options={MODEL_VERSIONS}
            onChange={(v) => set("modelVersion", v as ModelSettings["modelVersion"])}
          />
        </Field>

        <Field label="幾何細節" hint={p1 ? "P1 版本不支援精細幾何" : "精細的形狀較準確，扣點可能較多"}>
          <Select
            value={settings.geometryQuality}
            disabled={p1}
            options={[
              { value: "standard", label: "標準" },
              { value: "detailed", label: "精細" },
            ]}
            onChange={(v) => set("geometryQuality", v as ModelSettings["geometryQuality"])}
          />
        </Field>

        <div className="flex flex-col gap-2">
          <Check
            checked={settings.alignToImage}
            onChange={(v) => set("alignToImage", v)}
            label="擺放方向跟原圖一致"
          />
          <Check
            checked={settings.imageAutofix}
            onChange={(v) => set("imageAutofix", v)}
            label="先自動修正圖片再建模"
          />
          <Check
            checked={settings.generateParts}
            disabled={p1}
            onChange={(v) => set("generateParts", v)}
            label="拆成多個零件（可分開列印、分色組裝；建議搭配 3MF）"
          />
          <Check
            checked={settings.color}
            onChange={(v) => set("color", v)}
            label="彩色模型（會改用 OBJ 格式，產生時多扣點數）"
          />
        </div>
      </fieldset>

      <fieldset
        disabled={busy}
        className="flex flex-col gap-5 rounded-lg border border-zinc-300 p-4 disabled:opacity-50 dark:border-zinc-700"
      >
        <legend className="px-1 font-medium">列印設定</legend>

        <Field label={`模型高度（mm，${HEIGHT_MM.min}–${HEIGHT_MM.max}）`} hint="寬度與深度會依比例自動計算">
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="number"
              min={HEIGHT_MM.min}
              max={HEIGHT_MM.max}
              value={settings.heightMm}
              onChange={(e) => set("heightMm", Number(e.target.value))}
              className="w-28 rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
            />
            {HEIGHT_MM.presets.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => set("heightMm", preset)}
                className={`rounded-full border px-3 py-1 text-sm ${
                  settings.heightMm === preset
                    ? "border-foreground bg-foreground text-background"
                    : "border-zinc-300 dark:border-zinc-700"
                }`}
              >
                {preset} mm
              </button>
            ))}
          </div>
        </Field>

        <Field label="面數">
          <Select
            value={String(settings.faceLimit)}
            options={FACE_LIMIT.options.map((o) => ({ value: String(o.value), label: o.label }))}
            onChange={(v) => set("faceLimit", Number(v))}
          />
        </Field>

        <Field label="檔案格式" hint={settings.color ? "彩色模型只有 OBJ 能保留顏色" : undefined}>
          <Select
            value={settings.format}
            disabled={settings.color}
            options={FORMATS}
            onChange={(v) => set("format", v as ModelSettings["format"])}
          />
        </Field>

        <Check
          checked={settings.flattenBottom}
          onChange={(v) => set("flattenBottom", v)}
          label="底部壓平（比較好黏在列印平台上）"
        />
      </fieldset>

      <button
        type="button"
        onClick={handleStart}
        disabled={busy}
        className="h-12 rounded-full bg-foreground px-6 font-medium text-background transition-opacity disabled:opacity-50"
      >
        {busy
          ? "處理中…"
          : onlyReconvert
            ? "用新設定重新轉檔（約 1 分鐘，只扣轉檔點數）"
            : model3d
              ? "用新設定重新產生 3D 模型（約 2–3 分鐘）"
              : "第 2 步：產生 3D 列印檔（約 2–3 分鐘）"}
      </button>

      {error && <p className="rounded-lg bg-red-100 p-3 text-red-700">{error}</p>}

      {model3d && (
        <div className="flex flex-col gap-3">
          <p>
            {STATUS_TEXT[model3d.status]}
            {busy && `…（${model3d.progress}%）`}
          </p>
          {busy && (
            <div className="h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
              <div className="h-full bg-foreground transition-all" style={{ width: `${model3d.progress}%` }} />
            </div>
          )}
          {model3d.status === "failed" && (
            <p className="rounded-lg bg-red-100 p-3 text-red-700">{model3d.error}</p>
          )}
          {model3d.status === "done" && model3d.fileUrl && model3d.format && (
            <>
              <ModelPreview url={model3d.fileUrl} format={model3d.format} />
              {model3d.dimensionsMm && (
                <ul className="text-sm text-zinc-600 dark:text-zinc-400">
                  <li>
                    尺寸：寬 {model3d.dimensionsMm[0]} × 深 {model3d.dimensionsMm[1]} × 高{" "}
                    {model3d.dimensionsMm[2]} mm
                  </li>
                  <li>面數：{model3d.triangles?.toLocaleString()}</li>
                  <li>檔案大小：{((model3d.fileSizeBytes ?? 0) / 1024 / 1024).toFixed(1)} MB</li>
                </ul>
              )}
              <a
                href={model3d.fileUrl}
                download
                className="flex h-12 items-center justify-center rounded-full border border-zinc-300 font-medium dark:border-zinc-700"
              >
                下載 {model3d.format} 檔
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span>{label}</span>
      {children}
      {hint && <span className="text-sm text-zinc-500">{hint}</span>}
    </label>
  );
}

function Select({
  value,
  options,
  onChange,
  disabled,
}: {
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-lg border border-zinc-300 bg-transparent p-2 disabled:opacity-50 dark:border-zinc-700"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Check({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-2 ${disabled ? "opacity-50" : ""}`}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4"
      />
      <span>{label}</span>
    </label>
  );
}
