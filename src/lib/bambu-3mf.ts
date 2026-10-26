import "server-only";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import profiles from "@/data/bambu-profiles.json";
import { PLATES, type BambuSettings } from "@/lib/bambu-settings";
import { boundsSize, meshBounds, parseModel } from "@/lib/mesh";

// 把 Bambu Studio 設定寫進 3MF：用 Bambu Studio 打開就會套用印表機、線材和列印參數
// 做法（已用 Bambu Studio 實測）：
//   1. Metadata/project_settings.config 放「完整」設定：官方的印表機＋線材＋品質預設全部展開，再蓋上使用者的調整
//   2. 3dmodel.model 標記成 Bambu Studio 的專案，不然只會載入模型、忽略設定
//   3. 把模型移到該印表機平台的正中央、底部貼平台

type Config = Record<string, unknown>;
type Profile = { name: string; config: Config };
type PrinterProfiles = (typeof profiles.printers)[number] & {
  config: Config;
  processes: (Profile & { layerHeight: number })[];
  filaments: (Profile & { id: string })[];
};

// 標記成這個版本的 Bambu Studio 專案；比使用者的版本舊沒關係，太新的話 Bambu Studio 會跳警告
const PROJECT_VERSION = "02.00.00.00";

const first = (value: unknown) => Number(Array.isArray(value) ? value[0] : value);

// 列印板對應的熱床溫度欄位
const PLATE_TEMP_KEYS = {
  textured: "textured_plate_temp",
  smooth: "hot_plate_temp",
  cool: "cool_plate_temp",
} as const;

function buildProjectConfig(s: BambuSettings) {
  const printer = (profiles.printers as PrinterProfiles[]).find((p) => p.id === s.printer);
  const process = printer?.processes.find((p) => p.layerHeight === s.layerHeight);
  const filament = printer?.filaments.find((f) => f.id === s.filament);
  if (!printer || !process || !filament) throw new Error("找不到對應的 Bambu 官方預設");

  const processChanges: Config = {
    wall_loops: String(s.wallLoops),
    top_shell_layers: String(s.topLayers),
    bottom_shell_layers: String(s.bottomLayers),
    sparse_infill_density: `${s.infillDensity}%`,
    sparse_infill_pattern: s.infillPattern,
    enable_support: s.support ? "1" : "0",
    support_type: s.supportType,
    support_threshold_angle: String(s.supportAngle),
    brim_type: s.brim,
  };

  // 使用者只調一個溫度：其它層用這個值，首層跟官方預設差一樣多（官方首層常常比其它層低或高幾度）
  const nozzleDelta = s.nozzleTemp - first(filament.config.nozzle_temperature);
  const bedKey = PLATE_TEMP_KEYS[s.plate];
  const bedDelta = s.bedTemp - first(filament.config[bedKey]);
  const shifted = (key: string, delta: number) => [String(first(filament.config[key]) + delta)];
  const filamentChanges: Config = {
    nozzle_temperature: [String(s.nozzleTemp)],
    nozzle_temperature_initial_layer: shifted("nozzle_temperature_initial_layer", nozzleDelta),
    [bedKey]: [String(s.bedTemp)],
    [`${bedKey}_initial_layer`]: shifted(`${bedKey}_initial_layer`, bedDelta),
  };

  // 跟官方預設不一樣的欄位，Bambu Studio 會在介面上標示成「已修改」
  const changed = (base: Config, changes: Config) =>
    Object.keys(changes)
      .filter((key) => JSON.stringify(base[key]) !== JSON.stringify(changes[key]))
      .join(";");

  return {
    ...printer.config,
    ...filament.config,
    ...filamentChanges,
    ...process.config,
    ...processChanges,
    curr_bed_type: PLATES.find((p) => p.value === s.plate)!.bedType,
    printer_settings_id: printer.machine,
    print_settings_id: process.name,
    filament_settings_id: [filament.name],
    inherits_group: ["", "", ""],
    different_settings_to_system: [changed(process.config, processChanges), changed(filament.config, filamentChanges), ""],
    from: "project",
    name: "project_settings",
    version: PROJECT_VERSION,
  };
}

export function writeBambu3mf(input: Buffer, s: BambuSettings): Buffer {
  const printer = profiles.printers.find((p) => p.id === s.printer);
  if (!printer) throw new Error("印表機選項不正確");

  const bounds = meshBounds(parseModel("3MF", input));
  const size = boundsSize(bounds);
  const [bedX, bedY, bedZ] = printer.bed;
  if (size[0] > bedX || size[1] > bedY || size[2] > bedZ) {
    const mm = (v: number) => Math.round(v);
    throw new Error(
      `模型 ${size.map(mm).join("×")} mm 放不進 ${printer.label} 的平台 ${printer.bed.join("×")} mm，請先在第 2 步縮小尺寸`,
    );
  }

  const files = unzipSync(new Uint8Array(input));
  const modelPath = "3D/3dmodel.model";
  if (!files[modelPath]) throw new Error("3MF 裡找不到 3D/3dmodel.model");

  const num = (v: number) => Number(v.toFixed(4));
  const tx = num(bedX / 2 - (bounds.min[0] + bounds.max[0]) / 2);
  const ty = num(bedY / 2 - (bounds.min[1] + bounds.max[1]) / 2);
  const tz = num(-bounds.min[2]);

  let items = 0;
  const model = strFromU8(files[modelPath])
    .replace(
      /<model\b([^>]*)>/,
      (_, attrs: string) =>
        `<model${attrs} xmlns:BambuStudio="http://schemas.bambulab.com/package/2021">` +
        `\n<metadata name="Application">BambuStudio-${PROJECT_VERSION}</metadata>` +
        `\n<metadata name="BambuStudio:3mfVersion">1</metadata>`,
    )
    .replace(/<item objectid="(\d+)"\s*\/>/g, (_, id: string) => {
      items++;
      return `<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${tx} ${ty} ${tz}" printable="1"/>`;
    });
  if (items === 0) throw new Error("3MF 的格式跟預期不同，無法擺放模型");

  return Buffer.from(
    zipSync({
      ...files,
      [modelPath]: strToU8(model),
      "Metadata/project_settings.config": strToU8(JSON.stringify(buildProjectConfig(s), null, 4)),
    }),
  );
}
