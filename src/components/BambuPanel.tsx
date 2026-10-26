"use client";

import { useState } from "react";
import { Check, Chips, Field, PresetButton, Section, Select } from "@/components/form-controls";
import {
  ABRASIVE_FILAMENTS,
  BAMBU_PRINTERS,
  BRIM_TYPES,
  DEFAULT_BAMBU_SETTINGS,
  INFILL_PATTERNS,
  PLATES,
  QUICK_PRESETS,
  SUPPORT_TYPES,
  applyQuickPreset,
  findFilament,
  findPrinter,
  nearestLayerHeight,
  parseBambuSettings,
  withDefaultTemps,
  type BambuSettings,
  type PlateType,
} from "@/lib/bambu-settings";
import { downloadUrl } from "@/lib/blob-url";
import type { BambuView, GenerationView } from "@/lib/generation-view";

// 之前存的設定可能用到後來拿掉的選項，驗證不過就改用預設值
function initialSettings(model: GenerationView) {
  const saved = model.bambu && parseBambuSettings(model.bambu.settings);
  return saved && typeof saved !== "string" ? saved : DEFAULT_BAMBU_SETTINGS;
}

const formatMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default function BambuPanel({ models }: { models: GenerationView[] }) {
  const [selectedId, setSelectedId] = useState(models[0].id);
  const [settings, setSettings] = useState<BambuSettings>(() => initialSettings(models[0]));
  // 這次在頁面上產生的結果，蓋過頁面載入時的資料
  const [results, setResults] = useState<Record<string, BambuView>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const model = models.find((m) => m.id === selectedId) ?? models[0];
  const bambu = results[model.id] ?? model.bambu;
  const printer = findPrinter(settings.printer) ?? BAMBU_PRINTERS[0];
  const filament = findFilament(printer, settings.filament) ?? printer.filaments[0];

  const set = <K extends keyof BambuSettings>(key: K, value: BambuSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  function selectModel(next: GenerationView) {
    setSelectedId(next.id);
    setSettings(initialSettings(next));
    setError(null);
  }

  // 換印表機：線材沒有就換第一種、層高換最接近的、溫度改回官方建議值
  function changePrinter(id: string) {
    const next = findPrinter(id);
    if (!next) return;
    setSettings((s) =>
      fixPlate({
        ...s,
        printer: id,
        filament: findFilament(next, s.filament) ? s.filament : next.filaments[0].id,
        layerHeight: nearestLayerHeight(next, s.layerHeight),
      }),
    );
  }

  // 新線材不適合目前的列印板（官方溫度是 0）就換回紋理 PEI 板，再帶入官方溫度
  function fixPlate(s: BambuSettings) {
    const f = findFilament(findPrinter(s.printer)!, s.filament);
    const plate = f && f.bedTemp[s.plate] === 0 ? "textured" : s.plate;
    return withDefaultTemps({ ...s, plate });
  }

  const activePreset = QUICK_PRESETS.find((p) =>
    (Object.keys(p.settings) as (keyof typeof p.settings)[]).every(
      (key) =>
        key === "layerHeight"
          ? settings.layerHeight === nearestLayerHeight(printer, p.settings.layerHeight)
          : settings[key] === p.settings[key],
    ),
  )?.value;

  const dims = model.model3d?.dimensionsMm;
  const tooBig = dims && dims.some((v, i) => v > printer.bed[i]);
  const [nozzleLow, nozzleHigh] = filament.nozzleRange;

  async function handleSubmit() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/generations/${model.id}/bambu`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "產生 Bambu 檔失敗");
      setResults((r) => ({ ...r, [model.id]: data.bambu }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "產生 Bambu 檔失敗");
    } finally {
      setLoading(false);
    }
  }

  const numberInput = (key: keyof BambuSettings, min: number, max: number, unit?: string) => (
    <span className="flex items-center gap-2">
      <input
        type="number"
        min={min}
        max={max}
        step={1}
        value={settings[key] as number}
        onChange={(e) => set(key, Number(e.target.value) as never)}
        className="w-24 rounded-lg border border-zinc-300 bg-transparent p-2 dark:border-zinc-700"
      />
      {unit && <span className="text-sm text-zinc-500">{unit}</span>}
    </span>
  );

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold">1. 選擇模型</h2>
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {models.map((m) => {
            const b = results[m.id] ?? m.bambu;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => selectModel(m)}
                  className={`flex w-full flex-col overflow-hidden rounded-lg border text-left text-xs ${
                    m.id === model.id ? "border-foreground ring-2 ring-foreground" : "border-zinc-300 dark:border-zinc-700"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={m.outputImageUrl} alt="" className="aspect-square w-full bg-white object-contain" />
                  <span className="flex flex-col gap-0.5 p-2">
                    <span className="line-clamp-1">{m.prompt || "（上傳圖片）"}</span>
                    <span className="text-zinc-500">
                      {m.model3d?.dimensionsMm?.map((v) => Math.round(v)).join("×")} mm
                    </span>
                    {b && <span className={b.outdated ? "text-amber-600" : "text-zinc-500"}>{b.outdated ? "Bambu 檔需更新" : "已有 Bambu 檔"}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">2. 調整列印設定</h2>

        <Section title="印表機與線材" disabled={loading}>
          <Field label="印表機（0.4 噴嘴）" hint={`列印範圍 ${printer.bed.join("×")} mm`}>
            <Select
              value={printer.id}
              options={BAMBU_PRINTERS.map((p) => ({ value: p.id, label: p.label }))}
              onChange={changePrinter}
            />
          </Field>
          {tooBig && (
            <p className="rounded-lg bg-amber-100 p-3 text-sm text-amber-800">
              模型 {dims.map((v) => Math.round(v)).join("×")} mm 放不進這台印表機，請換印表機，或回到第 2 步縮小尺寸。
            </p>
          )}

          <Field label="線材">
            <Select
              value={filament.id}
              options={printer.filaments.map((f) => ({ value: f.id, label: `Bambu ${f.id}` }))}
              onChange={(id) => setSettings((s) => fixPlate({ ...s, filament: id }))}
            />
          </Field>
          {ABRASIVE_FILAMENTS.includes(filament.id) && (
            <p className="rounded-lg bg-amber-100 p-3 text-sm text-amber-800">
              {filament.id} 含碳纖維，需要硬化鋼噴嘴。A1、A1 mini、P1 系列原廠是不鏽鋼噴嘴，長時間使用會磨損。
            </p>
          )}

          <Field label="列印板" hint="熱床溫度會套用到這種板子">
            <Chips
              value={settings.plate}
              options={PLATES.filter((p) => filament.bedTemp[p.value] > 0)}
              onChange={(v) => setSettings((s) => withDefaultTemps({ ...s, plate: v as PlateType }))}
            />
          </Field>

          <div className="flex flex-wrap gap-6">
            <Field label="噴嘴溫度" hint={`官方建議 ${filament.nozzleTemp}°C，可用 ${nozzleLow}–${nozzleHigh}°C`}>
              {numberInput("nozzleTemp", nozzleLow, nozzleHigh, "°C")}
            </Field>
            <Field label="熱床溫度" hint={`官方建議 ${filament.bedTemp[settings.plate]}°C`}>
              {numberInput("bedTemp", 0, 110, "°C")}
            </Field>
          </div>
        </Section>

        <Section title="列印品質" disabled={loading}>
          <Field label="快速預設" hint="只會換掉層高、牆數、頂底層和填充，其他設定不變">
            <div className="flex flex-wrap gap-2">
              {QUICK_PRESETS.map((p) => (
                <PresetButton
                  key={p.value}
                  active={activePreset === p.value}
                  onClick={() => setSettings((s) => applyQuickPreset(s, p.value))}
                >
                  {p.label}
                </PresetButton>
              ))}
            </div>
          </Field>

          <Field label="層高" hint="越小越細緻，但列印時間越長">
            <Chips
              value={String(settings.layerHeight)}
              options={printer.layerHeights.map((h) => ({ value: String(h), label: `${h.toFixed(2)} mm` }))}
              onChange={(v) => set("layerHeight", Number(v))}
            />
          </Field>

          <div className="flex flex-wrap gap-6">
            <Field label="牆數">{numberInput("wallLoops", 1, 10)}</Field>
            <Field label="頂層數">{numberInput("topLayers", 0, 30)}</Field>
            <Field label="底層數">{numberInput("bottomLayers", 0, 30)}</Field>
            <Field label="填充密度">{numberInput("infillDensity", 0, 100, "%")}</Field>
          </div>

          <Field label="填充圖案">
            <Select
              value={settings.infillPattern}
              options={INFILL_PATTERNS}
              onChange={(v) => set("infillPattern", v as BambuSettings["infillPattern"])}
            />
          </Field>
        </Section>

        <Section title="支撐與附著" disabled={loading}>
          <Check checked={settings.support} onChange={(v) => set("support", v)} label="開啟支撐" />
          {settings.support && (
            <>
              <Field label="支撐類型" hint="樹狀支撐比較好拆，適合公仔、雕像這類有機外形">
                <Chips
                  value={settings.supportType}
                  options={SUPPORT_TYPES}
                  onChange={(v) => set("supportType", v as BambuSettings["supportType"])}
                />
              </Field>
              <Field label="懸垂角度門檻" hint="比這個角度更平的懸空面才加支撐；0 = 交給 Bambu Studio 自動判斷">
                {numberInput("supportAngle", 0, 90, "度")}
              </Field>
            </>
          )}
          <Field label="Brim（邊緣）" hint="在模型底部外圍多印一圈，幫助小底面或細長的模型黏住平台">
            <Chips value={settings.brim} options={BRIM_TYPES} onChange={(v) => set("brim", v as BambuSettings["brim"])} />
          </Field>
        </Section>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={loading || tooBig}
          className="h-12 rounded-full bg-foreground px-6 font-medium text-background transition-opacity disabled:opacity-50"
        >
          {loading ? "產生中…" : bambu ? "用這些設定重新產生 Bambu 3MF" : "產生 Bambu 3MF"}
        </button>
      </section>

      {error && <p className="rounded-lg bg-red-100 p-3 text-red-700">{error}</p>}

      {bambu && (
        <section className="flex flex-col gap-3 rounded-lg border border-zinc-300 p-4 dark:border-zinc-700">
          <h2 className="text-xl font-semibold">3. 下載</h2>
          {bambu.outdated && (
            <p className="rounded-lg bg-amber-100 p-3 text-sm text-amber-800">
              這個模型之後重新處理過（例如改了尺寸），這份 Bambu 檔還是舊的模型，請重新產生。
            </p>
          )}
          <p className="text-sm text-zinc-500">
            {new Date(bambu.updatedAt).toLocaleString("zh-TW", { dateStyle: "short", timeStyle: "short" })} 產生
            {bambu.fileSizeBytes ? `・${formatMb(bambu.fileSizeBytes)}` : ""}・
            {findPrinter(bambu.settings.printer)?.label}・Bambu {bambu.settings.filament}・層高 {bambu.settings.layerHeight} mm
          </p>
          <a
            href={downloadUrl(bambu.fileUrl)}
            className="flex h-12 items-center justify-center rounded-full border border-foreground px-6 font-medium"
          >
            下載 Bambu 3MF
          </a>
          <p className="text-sm text-zinc-500">用 Bambu Studio 打開；如果詢問是否載入專案設定，請選「是」。</p>
        </section>
      )}
    </div>
  );
}
