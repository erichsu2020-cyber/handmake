"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Chips, Field, PresetButton, Section, Select } from "@/components/form-controls";
import { downloadUrl } from "@/lib/blob-url";
import type { Model3dStatus, Model3dView } from "@/lib/generation-view";
import {
  APPEARANCE_MATERIALS,
  BED_PRESETS,
  DEFAULT_SETTINGS,
  FACE_LIMIT,
  FORMATS,
  MODEL_VERSIONS,
  SIZE_PRESETS,
  SIZE_RANGE,
  canUseMeshOps,
  isP1,
  sameConvertOptions,
  sameGenerateOptions,
  sameTextureOptions,
  type ModelSettings,
  type SizeAxis,
  type SizeMode,
} from "@/lib/print-settings";

// three.js 與 localStorage 只能在瀏覽器執行
const ModelPreview = dynamic(() => import("@/components/ModelPreview"), { ssr: false });
const PrintEstimatePanel = dynamic(() => import("@/components/PrintEstimatePanel"), { ssr: false });

const STATUS_TEXT: Record<Model3dStatus, string> = {
  generating: "Tripo3D 產生 3D 模型中",
  texturing: "套用外觀材質中",
  converting: "轉檔中",
  uploading: "儲存模型檔中",
  processing: "調整尺寸、切開、空心化中",
  done: "完成",
  failed: "失敗",
};

const SIZE_MODES: { value: SizeMode; label: string }[] = [
  { value: "axis", label: "指定一邊" },
  { value: "fit", label: "符合列印平台" },
  { value: "xyz", label: "長寬高各自指定" },
];

const SIZE_AXES: { value: SizeAxis; label: string }[] = [
  { value: "height", label: "高度" },
  { value: "width", label: "寬度" },
  { value: "depth", label: "深度" },
];

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

// 跟後端同一套判斷：這次會從哪一步開始做
function plannedStep(m: Model3dView | null, s: ModelSettings) {
  const needsTexture = s.color && s.appearance !== "none";
  const reuseModel = !!m && (m.modelReady || !!m.convertTaskId) && sameGenerateOptions(m, s);
  const reuseTexture = reuseModel && (!needsTexture || (!!m!.textureReady && sameTextureOptions(m!, s)));
  if (reuseTexture && m!.rawFileUrl && sameConvertOptions(m!, s)) return "process";
  if (reuseTexture) return "convert";
  if (reuseModel) return "texture";
  return "generate";
}

const STEP_BUTTON = {
  process: "套用新設定（只在本機處理，不扣點數）",
  convert: "用新設定重新轉檔（約 1 分鐘，只扣轉檔點數）",
  texture: "重新套用外觀材質並轉檔（約 1–2 分鐘）",
  generate: "產生 3D 列印檔（約 2–3 分鐘）",
};

export default function ModelPanel({
  generationId,
  initialModel3d,
}: {
  // 首頁還沒完成第 1 步時沒有 id：設定可以先選，但不能送出
  generationId?: string;
  initialModel3d?: Model3dView;
}) {
  const [model3d, setModel3d] = useState<Model3dView | null>(initialModel3d ?? null);
  const [settings, setSettings] = useState<ModelSettings>(() => settingsFrom(initialModel3d));
  const [error, setError] = useState<string | null>(null);
  const pollingRef = useRef(false);
  const url = `/api/generations/${generationId}/model3d`;

  // 換了一張新圖：清掉上一張的結果，但保留已選好的設定
  const [shownId, setShownId] = useState(generationId);
  if (shownId !== generationId) {
    setShownId(generationId);
    setModel3d(initialModel3d ?? null);
    setError(null);
  }

  const set = <K extends keyof ModelSettings>(key: K, value: ModelSettings[K]) =>
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      // 互斥規則
      if (key === "color" && value) Object.assign(next, { format: "OBJ", generateParts: false });
      if (key === "color" && !value) next.appearance = "none";
      if (key === "generateParts" && value) next.color = false;
      if (key === "format" && value !== "OBJ") Object.assign(next, { color: false, appearance: "none" });
      if (key === "modelVersion" && isP1(value as string)) {
        Object.assign(next, { generateParts: false, geometryQuality: "standard" });
      }
      if (!canUseMeshOps(next)) {
        Object.assign(next, { trimBottomMm: 0, cutAtPercent: 0, hollowWallMm: 0, drainHole: false });
      }
      if (next.hollowWallMm === 0) next.drainHole = false;
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
  const meshOps = canUseMeshOps(settings);
  const step = plannedStep(model3d, settings);
  const numberInput = (key: keyof ModelSettings, min = SIZE_RANGE.min, max = SIZE_RANGE.max, stepSize = 1) => (
    <input
      type="number"
      min={min}
      max={max}
      step={stepSize}
      value={settings[key] as number}
      onChange={(e) => set(key, Number(e.target.value) as never)}
      className="w-24 rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <Section title="3D 模型" disabled={busy}>
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
          <Check checked={settings.alignToImage} onChange={(v) => set("alignToImage", v)} label="擺放方向跟原圖一致" />
          <Check checked={settings.imageAutofix} onChange={(v) => set("imageAutofix", v)} label="先自動修正圖片再建模" />
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
      </Section>

      <Section title="外觀材質" disabled={busy}>
        <Field
          label="模型表面的材質質感"
          hint={settings.color ? "會用 Tripo 重新上貼圖（約 10 點）" : "需要先勾選「彩色模型」才看得到材質顏色"}
        >
          <Chips
            options={APPEARANCE_MATERIALS}
            value={settings.appearance}
            disabled={!settings.color}
            onChange={(v) => set("appearance", v as ModelSettings["appearance"])}
          />
        </Field>
      </Section>

      <Section title="尺寸大小" disabled={busy}>
        <Chips options={SIZE_MODES} value={settings.sizeMode} onChange={(v) => set("sizeMode", v as SizeMode)} />

        {settings.sizeMode === "axis" && (
          <Field label="指定哪一邊的長度（mm），其他邊等比例計算">
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={settings.sizeAxis}
                options={SIZE_AXES}
                onChange={(v) => set("sizeAxis", v as SizeAxis)}
              />
              {numberInput("sizeMm")}
              <span className="text-sm text-zinc-500">mm</span>
              {SIZE_PRESETS.map((preset) => (
                <PresetButton key={preset} active={settings.sizeMm === preset} onClick={() => set("sizeMm", preset)}>
                  {preset}
                </PresetButton>
              ))}
            </div>
          </Field>
        )}

        {settings.sizeMode === "fit" && (
          <Field label="列印平台可列印範圍（mm），會等比例放到最大">
            <div className="flex flex-wrap items-center gap-2">
              {numberInput("bedX")} × {numberInput("bedY")} × {numberInput("bedZ")}
            </div>
            <div className="flex flex-wrap gap-2">
              {BED_PRESETS.map((bed) => (
                <PresetButton
                  key={bed.label}
                  active={settings.bedX === bed.x && settings.bedY === bed.y && settings.bedZ === bed.z}
                  onClick={() => setSettings((prev) => ({ ...prev, bedX: bed.x, bedY: bed.y, bedZ: bed.z }))}
                >
                  {bed.label}
                </PresetButton>
              ))}
            </div>
          </Field>
        )}

        {settings.sizeMode === "xyz" && (
          <Field label="寬 × 深 × 高（mm）" hint="⚠️ 三邊各自縮放，模型可能會被拉長或壓扁">
            <div className="flex flex-wrap items-center gap-2">
              {numberInput("sizeX")} × {numberInput("sizeY")} × {numberInput("sizeZ")}
            </div>
          </Field>
        )}
      </Section>

      <Section title="檔案" disabled={busy}>
        <div className="grid gap-4 sm:grid-cols-2">
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
        </div>
        <Check
          checked={settings.flattenBottom}
          onChange={(v) => set("flattenBottom", v)}
          label="底部壓平（比較好黏在列印平台上）"
        />
      </Section>

      <Section title="切割與空心化" disabled={busy || !meshOps}>
        {!meshOps && (
          <p className="text-sm text-zinc-500">拆零件、P1 版本或彩色 OBJ 的模型不能切開或空心化</p>
        )}
        <Field label="從底部切掉（mm）" hint="底部不平時可以切掉一段，讓底面完全平整；0 = 不切">
          <div className="flex items-center gap-2">{numberInput("trimBottomMm", 0, 50, 0.5)} mm</div>
        </Field>

        <Check
          checked={settings.cutAtPercent > 0}
          onChange={(v) => set("cutAtPercent", v ? 50 : 0)}
          label="切成上下兩塊（太高印不下、或想分開列印時）"
        />
        {settings.cutAtPercent > 0 && (
          <Field label={`切開位置：高度的 ${settings.cutAtPercent}%`} hint="上半部會翻過來，讓切面朝下平放在平台上">
            <input
              type="range"
              min={10}
              max={90}
              step={5}
              value={settings.cutAtPercent}
              onChange={(e) => set("cutAtPercent", Number(e.target.value))}
            />
          </Field>
        )}

        <Check
          checked={settings.hollowWallMm > 0}
          onChange={(v) => set("hollowWallMm", v ? 2 : 0)}
          label="空心化（挖空內部只留外殼，省材料；樹脂列印特別有用）"
        />
        {settings.hollowWallMm > 0 && (
          <>
            <Field label="壁厚（mm，1–10）" hint="處理時間約 5–15 秒">
              <div className="flex items-center gap-2">{numberInput("hollowWallMm", 1, 10, 0.5)} mm</div>
            </Field>
            <Check
              checked={settings.drainHole}
              onChange={(v) => set("drainHole", v)}
              label="在底部開排液孔（直徑 3mm，讓樹脂流出來）"
            />
          </>
        )}
      </Section>

      <button
        type="button"
        onClick={handleStart}
        disabled={busy || !generationId}
        className="h-12 rounded-full bg-foreground px-6 font-medium text-background transition-opacity disabled:opacity-50"
      >
        {!generationId ? "請先完成第 1 步" : busy ? "處理中…" : STEP_BUTTON[step]}
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
                    尺寸：寬 {model3d.dimensionsMm[0]} × 深 {model3d.dimensionsMm[1]} × 高 {model3d.dimensionsMm[2]} mm
                  </li>
                  {(model3d.pieces ?? 1) > 1 && <li>共 {model3d.pieces} 塊（已在檔案中並排擺好）</li>}
                  <li>面數：{model3d.triangles?.toLocaleString()}</li>
                  <li>檔案大小：{((model3d.fileSizeBytes ?? 0) / 1024 / 1024).toFixed(1)} MB</li>
                </ul>
              )}
              <a
                href={downloadUrl(model3d.fileUrl)}
                download
                className="flex h-12 items-center justify-center rounded-full border border-zinc-300 font-medium dark:border-zinc-700"
              >
                下載 {model3d.format} 檔
              </a>
              {model3d.stats && model3d.dimensionsMm && (
                <PrintEstimatePanel stats={model3d.stats} heightMm={model3d.dimensionsMm[2]} />
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
