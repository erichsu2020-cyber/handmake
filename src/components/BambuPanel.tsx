"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import BambuModelPicker, { fromGeneration, fromUpload, type BambuModel } from "@/components/BambuModelPicker";
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
  DEFAULT_NOZZLE,
  applyQuickPreset,
  findFilament,
  findNozzle,
  findPrinter,
  findSetup,
  nearestLayerHeight,
  parseBambuSettings,
  withDefaultTemps,
  type BambuSettings,
  type PlateType,
} from "@/lib/bambu-settings";
import { downloadUrl } from "@/lib/blob-url";
import type { BambuUploadView, BambuView, GenerationView } from "@/lib/generation-view";

// three.js 只能在瀏覽器執行
const ModelPreview = dynamic(() => import("@/components/ModelPreview"), { ssr: false });

// 之前存的設定可能用到後來拿掉的選項，驗證不過就改用預設值
function initialSettings(model: BambuModel | undefined) {
  const saved = model?.bambu && parseBambuSettings(model.bambu.settings);
  return saved && typeof saved !== "string" ? saved : DEFAULT_BAMBU_SETTINGS;
}

const formatMb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export default function BambuPanel({
  generations,
  uploads: initialUploads,
}: {
  generations: GenerationView[];
  uploads: BambuUploadView[];
}) {
  const siteModels = generations.map(fromGeneration);
  // 上傳和刪除會改變列表，所以放在 state
  const [uploads, setUploads] = useState(() => initialUploads.map(fromUpload));
  const [selectedKey, setSelectedKey] = useState<string | null>(() => (siteModels[0] ?? uploads[0])?.key ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settings, setSettings] = useState<BambuSettings>(() => initialSettings(siteModels[0] ?? uploads[0]));
  // 這次在頁面上產生的結果，蓋過頁面載入時的資料
  const [results, setResults] = useState<Record<string, BambuView>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const model = [...siteModels, ...uploads].find((m) => m.key === selectedKey);
  const bambu = model && (results[model.key] ?? model.bambu);
  const printer = findPrinter(settings.printer) ?? BAMBU_PRINTERS[0];
  const nozzle = findNozzle(printer, settings.nozzle) ?? printer.nozzles[0];
  const filament = findFilament(nozzle, settings.filament) ?? nozzle.filaments[0];

  const set = <K extends keyof BambuSettings>(key: K, value: BambuSettings[K]) =>
    setSettings((s) => ({ ...s, [key]: value }));

  function selectModel(next: BambuModel) {
    setSelectedKey(next.key);
    setSettings(initialSettings({ ...next, bambu: results[next.key] ?? next.bambu }));
    setError(null);
    setPickerOpen(false);
  }

  // 換印表機或噴嘴：噴嘴沒有就用 0.4（或第一個）、線材沒有就換第一種、層高換最接近的、溫度改回官方建議值
  function changeSetup(printerId: string, diameter: number) {
    const nextPrinter = findPrinter(printerId);
    if (!nextPrinter) return;
    const nextNozzle =
      findNozzle(nextPrinter, diameter) ?? findNozzle(nextPrinter, DEFAULT_NOZZLE) ?? nextPrinter.nozzles[0];
    setSettings((s) =>
      fixPlate({
        ...s,
        printer: printerId,
        nozzle: nextNozzle.diameter,
        filament: findFilament(nextNozzle, s.filament) ? s.filament : nextNozzle.filaments[0].id,
        layerHeight: nearestLayerHeight(nextNozzle, s.layerHeight),
      }),
    );
  }

  // 新線材不適合目前的列印板（官方溫度是 0）就換回紋理 PEI 板，再帶入官方溫度
  function fixPlate(s: BambuSettings) {
    const setup = findSetup(s);
    const f = setup && findFilament(setup.nozzle, s.filament);
    const plate = f && f.bedTemp[s.plate] === 0 ? "textured" : s.plate;
    return withDefaultTemps({ ...s, plate });
  }

  const activePreset = QUICK_PRESETS.find((p) =>
    (Object.keys(p.settings) as (keyof typeof p.settings)[]).every(
      (key) =>
        key === "layerHeight"
          ? settings.layerHeight === nearestLayerHeight(nozzle, p.settings.layerHeight)
          : settings[key] === p.settings[key],
    ),
  )?.value;

  const dims = model?.dimensionsMm;
  const tooBig = dims && dims.some((v, i) => v > nozzle.bed[i]);
  const [nozzleLow, nozzleHigh] = filament.nozzleRange;

  async function handleSubmit() {
    if (!model) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(model.bambuApi, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "產生 Bambu 檔失敗");
      setResults((r) => ({ ...r, [model.key]: data.bambu }));
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
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xl font-semibold">1. 選擇模型</h2>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            disabled={loading}
            className="rounded-full border border-foreground px-4 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {model ? "更換檔案" : "開啟檔案"}
          </button>
        </div>

        {model ? (
          <div className="flex flex-col gap-3 rounded-lg border border-zinc-300 p-3 dark:border-zinc-700">
            {/* key：換模型時重新建立預覽，不會殘留上一個模型 */}
            <ModelPreview key={model.key} url={model.fileUrl} format="3MF" />
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{model.name}</span>
              <span className="text-zinc-500">
                {model.kind === "upload" ? "從電腦上傳" : "網站上的模型"}
                {dims && `・寬 ${dims[0]} × 深 ${dims[1]} × 高 ${dims[2]} mm`}
              </span>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="flex flex-col items-center gap-1 rounded-lg border-2 border-dashed border-zinc-300 p-10 text-center dark:border-zinc-700"
          >
            <span className="font-medium">開啟檔案</span>
            <span className="text-sm text-zinc-500">選擇網站上完成的 3MF，或從電腦上傳 STL／3MF</span>
          </button>
        )}

        <BambuModelPicker
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          generations={siteModels}
          uploads={uploads}
          selectedKey={selectedKey}
          onSelect={selectModel}
          onUploaded={(u) => {
            const next = fromUpload(u);
            setUploads((list) => [next, ...list]);
            selectModel(next);
          }}
          onDeleted={(key) => {
            setUploads((list) => list.filter((m) => m.key !== key));
            if (key === selectedKey) setSelectedKey(null);
          }}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">2. 調整列印設定</h2>

        <Section title="印表機與線材" disabled={loading}>
          <Field label="印表機" hint={`列印範圍 ${nozzle.bed.join("×")} mm`}>
            <Select
              value={printer.id}
              options={BAMBU_PRINTERS.map((p) => ({ value: p.id, label: p.label }))}
              onChange={(id) => changeSetup(id, settings.nozzle)}
            />
          </Field>
          <Field label="噴嘴" hint="小噴嘴細節較好但較慢；大噴嘴較快、較堅固，適合大型模型">
            <Chips
              value={String(nozzle.diameter)}
              options={printer.nozzles.map((n) => ({ value: String(n.diameter), label: `${n.diameter} mm` }))}
              onChange={(v) => changeSetup(printer.id, Number(v))}
            />
          </Field>
          {tooBig && (
            <p className="rounded-lg bg-amber-100 p-3 text-sm text-amber-800">
              模型 {dims.map((v) => Math.round(v)).join("×")} mm 放不進這台印表機，請換印表機，或先縮小模型。
            </p>
          )}

          <Field label="線材">
            <Select
              value={filament.id}
              options={nozzle.filaments.map((f) => ({ value: f.id, label: `Bambu ${f.id}` }))}
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
              options={nozzle.layerHeights.map((h) => ({ value: String(h), label: `${h.toFixed(2)} mm` }))}
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
          disabled={loading || tooBig || !model}
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
            {findPrinter(bambu.settings.printer)?.label}・{bambu.settings.nozzle} mm 噴嘴・Bambu {bambu.settings.filament}・層高 {bambu.settings.layerHeight} mm
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
