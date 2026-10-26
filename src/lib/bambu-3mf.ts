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

// 官方預設裡，有些設定依噴嘴類型（一般／高流量…）各存一組值，例如 H2S 的 nozzle_temperature: ["220","220","220"]。
// Bambu Studio 存專案時只留下目前噴嘴類型那一組；沒篩掉的話，打開時會出現「Invalid configuration file」。
// 清單抄自 Bambu Studio 原始碼 src/libslic3r/PrintConfig.cpp（*_options_with_variant），官方新增欄位時要跟著更新
const PRINTER_VARIANT_KEYS = [
  "nozzle_volume", "retraction_length", "z_hop", "retract_lift_above", "retract_lift_below", "z_hop_types",
  "retraction_speed", "deretraction_speed", "retraction_minimum_travel", "retract_when_changing_layer", "wipe",
  "wipe_distance", "retract_before_wipe", "retract_length_toolchange", "retract_restart_extra",
  "retract_restart_extra_toolchange", "long_retractions_when_cut", "retraction_distances_when_cut",
  "printer_extruder_id", "printer_extruder_variant", "hotend_cooling_rate", "hotend_heating_rate", "nozzle_flush_dataset",
];
// 每組有兩個值（一般模式、靜音模式）
const PRINTER_VARIANT_KEYS_2 = [
  "machine_max_acceleration_x", "machine_max_acceleration_y", "machine_max_acceleration_z", "machine_max_acceleration_e",
  "machine_max_acceleration_extruding", "machine_max_acceleration_retracting", "machine_max_acceleration_travel",
  "machine_max_speed_x", "machine_max_speed_y", "machine_max_speed_z", "machine_max_speed_e",
  "machine_max_jerk_x", "machine_max_jerk_y", "machine_max_jerk_z", "machine_max_jerk_e",
];
const PROCESS_VARIANT_KEYS = [
  "initial_layer_speed", "initial_layer_infill_speed", "outer_wall_speed", "inner_wall_speed", "small_perimeter_speed",
  "small_perimeter_threshold", "sparse_infill_speed", "internal_solid_infill_speed", "vertical_shell_speed",
  "top_surface_speed", "enable_overhang_speed", "overhang_1_4_speed", "overhang_2_4_speed", "overhang_3_4_speed",
  "overhang_4_4_speed", "overhang_totally_speed", "enable_height_slowdown", "slowdown_start_height",
  "slowdown_start_speed", "slowdown_start_acc", "slowdown_end_height", "slowdown_end_speed", "slowdown_end_acc",
  "bridge_speed", "gap_infill_speed", "support_speed", "support_interface_speed", "travel_speed", "travel_speed_z",
  "default_acceleration", "travel_acceleration", "travel_short_distance_acceleration",
  "initial_layer_travel_acceleration", "initial_layer_acceleration", "outer_wall_acceleration",
  "inner_wall_acceleration", "sparse_infill_acceleration", "top_surface_acceleration", "print_extruder_id",
  "print_extruder_variant", "top_solid_infill_flow_ratio",
];
const FILAMENT_VARIANT_KEYS = [
  "filament_flow_ratio", "filament_max_volumetric_speed", "filament_ramming_volumetric_speed",
  "filament_pre_cooling_temperature", "filament_ramming_travel_time", "filament_ramming_volumetric_speed_nc",
  "filament_pre_cooling_temperature_nc", "filament_ramming_travel_time_nc", "filament_extruder_variant",
  "filament_retraction_length", "filament_retract_length_nc", "filament_z_hop", "filament_z_hop_types",
  "filament_retract_restart_extra", "filament_retraction_speed", "filament_deretraction_speed",
  "filament_retraction_minimum_travel", "filament_retract_when_changing_layer", "filament_wipe",
  "filament_wipe_distance", "filament_retract_before_wipe", "filament_long_retractions_when_cut",
  "filament_retraction_distances_when_cut", "long_retractions_when_ec", "retraction_distances_when_ec",
  "nozzle_temperature_initial_layer", "nozzle_temperature", "filament_flush_volumetric_speed", "filament_flush_temp",
  "filament_flush_temp_fast", "filament_enable_overhang_speed", "filament_bridge_speed", "filament_overhang_1_4_speed",
  "filament_overhang_2_4_speed", "filament_overhang_3_4_speed", "filament_overhang_4_4_speed",
  "filament_overhang_totally_speed", "override_process_overhang_speed", "volumetric_speed_coefficients",
  "filament_adaptive_volumetric_speed", "filament_preheat_temperature_delta", "filament_cooling_before_tower",
  "slow_down_min_speed",
];

// 原廠附的一般噴嘴；以後要支援高流量噴嘴時改這裡（Bambu 的名稱是「擠出機類型 + 噴嘴流量類型」）
const NOZZLE_VOLUME_TYPE = "Standard";

// 從依噴嘴類型分組的陣列中，只留下目前噴嘴類型那一組
function selectVariant(config: Config, variantKey: string, keys: string[], stride = 1): Config {
  const extruderType = (config.extruder_type as string[] | undefined)?.[0] ?? "Direct Drive";
  const wanted = `${extruderType} ${NOZZLE_VOLUME_TYPE}`;
  const variants = config[variantKey];
  if (!Array.isArray(variants)) return config;
  const index = variants.indexOf(wanted);
  if (index < 0) throw new Error(`官方預設裡找不到「${wanted}」噴嘴的設定（${variantKey}）`);

  const result = { ...config };
  for (const key of keys) {
    const value = config[key];
    if (Array.isArray(value)) result[key] = value.slice(index * stride, index * stride + stride);
  }
  return result;
}

// 官方設定的值有的是字串、有的是陣列；陣列每一個值都要換掉
const fill = (base: unknown, value: number | string) =>
  Array.isArray(base) ? base.map(() => String(value)) : String(value);
// 跟官方預設差一樣多（官方首層常常比其它層低或高幾度），陣列每一組各自位移
const shift = (base: unknown, delta: number) =>
  Array.isArray(base) ? base.map((v) => String(Number(v) + delta)) : String(Number(base) + delta);

function buildProjectConfig(profiles: NozzleProfiles, s: BambuSettings) {
  const process = profiles.processes.find((p) => p.layerHeight === s.layerHeight);
  const filament = profiles.filaments.find((f) => f.id === s.filament);
  if (!process || !filament) throw new Error("找不到對應的 Bambu 官方預設");
  // 印表機的噴嘴類型清單決定要挑哪一組，品質和線材也用同一種
  const machine = selectVariant(
    selectVariant(profiles.config, "printer_extruder_variant", PRINTER_VARIANT_KEYS_2, 2),
    "printer_extruder_variant",
    PRINTER_VARIANT_KEYS,
  );
  const withExtruder = (config: Config) => ({ extruder_type: profiles.config.extruder_type, ...config });
  const p = selectVariant(withExtruder(process.config), "print_extruder_variant", PROCESS_VARIANT_KEYS);
  const f = selectVariant(withExtruder(filament.config), "filament_extruder_variant", FILAMENT_VARIANT_KEYS);
  delete p.extruder_type;
  delete f.extruder_type;

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
    ...machine,
    ...f,
    ...filamentChanges,
    ...p,
    ...processChanges,
    // Bambu Studio 用 filament_colour 的數量判斷有幾捲線材，自己存的專案一定會有
    filament_colour: ["#FFFFFF"],
    nozzle_volume_type: [NOZZLE_VOLUME_TYPE],
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
