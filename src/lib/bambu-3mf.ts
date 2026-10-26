import "server-only";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { PLATES, findSetup, type BambuSettings } from "@/lib/bambu-settings";
import { boundsSize, meshBounds, parseModel } from "@/lib/mesh";

// 把 Bambu Studio 設定寫進 3MF：用 Bambu Studio 打開就會套用印表機、線材和列印參數
// 做法（已用 Bambu Studio 實測）：
//   1. Metadata/project_settings.config 放「完整」設定：官方的印表機＋線材＋品質預設全部展開，再蓋上使用者的調整
//   2. 3dmodel.model 標記成 Bambu Studio 的專案，不然只會載入模型、忽略設定
//   3. 把模型移到該印表機平台的正中央、底部貼平台

type Config = Record<string, unknown>;
type Profile = { name: string; config: Config };
// scripts/bambu-profiles.mts 產生的 src/data/bambu/<印表機>-<噴嘴>.json
type NozzleProfiles = {
  machine: string;
  bed: number[];
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

// 每台印表機＋噴嘴一個檔案（約 100KB），只載入需要的那一個
async function loadProfiles(s: BambuSettings): Promise<NozzleProfiles> {
  const nozzle = s.nozzle.toFixed(1);
  // 用相對路徑，打包工具才認得出這是 src/data/bambu/ 底下的 JSON
  const mod = await import(`../data/bambu/${s.printer}-${nozzle}.json`);
  return mod.default as NozzleProfiles;
}

// 官方設定的值有的是字串、有的是陣列；陣列（例如 H2S 依噴嘴類型分成好幾組）每一組都要換掉
const fill = (base: unknown, value: number | string) =>
  Array.isArray(base) ? base.map(() => String(value)) : String(value);
// 跟官方預設差一樣多（官方首層常常比其它層低或高幾度），陣列每一組各自位移
const shift = (base: unknown, delta: number) =>
  Array.isArray(base) ? base.map((v) => String(Number(v) + delta)) : String(Number(base) + delta);

function buildProjectConfig(profiles: NozzleProfiles, s: BambuSettings) {
  const process = profiles.processes.find((p) => p.layerHeight === s.layerHeight);
  const filament = profiles.filaments.find((f) => f.id === s.filament);
  if (!process || !filament) throw new Error("找不到對應的 Bambu 官方預設");
  const p = process.config;
  const f = filament.config;

  const processChanges: Config = {
    wall_loops: fill(p.wall_loops, s.wallLoops),
    top_shell_layers: fill(p.top_shell_layers, s.topLayers),
    bottom_shell_layers: fill(p.bottom_shell_layers, s.bottomLayers),
    sparse_infill_density: fill(p.sparse_infill_density, `${s.infillDensity}%`),
    sparse_infill_pattern: fill(p.sparse_infill_pattern, s.infillPattern),
    enable_support: fill(p.enable_support, s.support ? "1" : "0"),
    support_type: fill(p.support_type, s.supportType),
    support_threshold_angle: fill(p.support_threshold_angle, s.supportAngle),
    brim_type: fill(p.brim_type, s.brim),
  };

  // 使用者只調一個溫度：其它層用這個值，首層跟著位移
  const nozzleDelta = s.nozzleTemp - first(f.nozzle_temperature);
  const bedKey = PLATE_TEMP_KEYS[s.plate];
  const bedDelta = s.bedTemp - first(f[bedKey]);
  const filamentChanges: Config = {
    nozzle_temperature: fill(f.nozzle_temperature, s.nozzleTemp),
    nozzle_temperature_initial_layer: shift(f.nozzle_temperature_initial_layer, nozzleDelta),
    [bedKey]: fill(f[bedKey], s.bedTemp),
    [`${bedKey}_initial_layer`]: shift(f[`${bedKey}_initial_layer`], bedDelta),
  };

  // 跟官方預設不一樣的欄位，Bambu Studio 會在介面上標示成「已修改」
  const changed = (base: Config, changes: Config) =>
    Object.keys(changes)
      .filter((key) => JSON.stringify(base[key]) !== JSON.stringify(changes[key]))
      .join(";");

  return {
    ...profiles.config,
    ...f,
    ...filamentChanges,
    ...p,
    ...processChanges,
    curr_bed_type: PLATES.find((plate) => plate.value === s.plate)!.bedType,
    printer_settings_id: profiles.machine,
    print_settings_id: process.name,
    filament_settings_id: [filament.name],
    inherits_group: ["", "", ""],
    different_settings_to_system: [changed(p, processChanges), changed(f, filamentChanges), ""],
    from: "project",
    name: "project_settings",
    version: PROJECT_VERSION,
  };
}

export async function writeBambu3mf(input: Buffer, s: BambuSettings): Promise<Buffer> {
  const setup = findSetup(s);
  if (!setup) throw new Error("印表機或噴嘴選項不正確");
  const profiles = await loadProfiles(s);

  const bounds = meshBounds(parseModel("3MF", input));
  const size = boundsSize(bounds);
  const [bedX, bedY, bedZ] = profiles.bed;
  if (size[0] > bedX || size[1] > bedY || size[2] > bedZ) {
    const mm = (v: number) => Math.round(v);
    throw new Error(
      `模型 ${size.map(mm).join("×")} mm 放不進 ${setup.printer.label} 的平台 ${profiles.bed.join("×")} mm，請先在第 2 步縮小尺寸`,
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
      "Metadata/project_settings.config": strToU8(JSON.stringify(buildProjectConfig(profiles, s), null, 4)),
    }),
  );
}
