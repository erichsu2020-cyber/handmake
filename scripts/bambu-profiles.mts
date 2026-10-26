// 下載 Bambu Studio 官方預設，展開繼承後存到 src/data/
//
//   node scripts/bambu-profiles.mts
//
// Bambu Studio 打開 3MF 時，project_settings.config 缺少的項目會用它內建的空白預設補上（不是用印表機的預設），
// 所以這裡要把每個預設沿著 inherits 一路展開成完整設定，G-code 等放在 include 範本裡的內容也要一起併進來。
// 官方預設更新時重跑一次就好
//   bambu/<印表機>-<噴嘴>.json：完整設定，只在伺服器寫 3MF 時載入需要的那一個
//   bambu-catalog.json：頁面用的小目錄（印表機、噴嘴、平台尺寸、層高、線材與預設溫度）

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";

const BASE = "https://raw.githubusercontent.com/bambulab/BambuStudio/master/resources/profiles/BBL";
const OUTPUT_DIR = new URL("../src/data/bambu/", import.meta.url);
const CATALOG = new URL("../src/data/bambu-catalog.json", import.meta.url);

// 第一個是頁面的預設印表機
const PRINTERS = [
  { id: "H2S", label: "Bambu Lab H2S" },
  { id: "A1M", label: "Bambu Lab A1 mini" },
  { id: "A1", label: "Bambu Lab A1" },
  { id: "P1P", label: "Bambu Lab P1P" },
  { id: "P1S", label: "Bambu Lab P1S" },
  { id: "X1C", label: "Bambu Lab X1 Carbon" },
  { id: "P2S", label: "Bambu Lab P2S" },
];
const NOZZLES = ["0.2", "0.4", "0.6", "0.8"];

const FILAMENTS = [
  "PLA Basic",
  "PLA Matte",
  "PLA Silk+",
  "PLA Marble",
  "PLA Translucent",
  "PETG Basic",
  "PETG HF",
  "PETG Translucent",
  "PETG-CF",
  "ABS",
  "TPU 95A HF",
];

// 只是用來描述預設本身的欄位，不是列印設定
const META_KEYS = [
  "name",
  "inherits",
  "include",
  "type",
  "instantiation",
  "setting_id",
  "from",
  "description",
  "filament_id",
  "base_id",
  "is_custom_defined",
  "compatible_printers",
  "compatible_printers_condition",
  "compatible_prints",
  "compatible_prints_condition",
];

type Kind = "machine" | "process" | "filament";
type Profile = Record<string, unknown> & { name: string; inherits?: string; include?: string[] };

type Index = Record<`${Kind}_list`, { name: string; sub_path: string }[]> & { version: string };
const index = (await (await fetch(`${BASE}.json`)).json()) as Index;
const paths = new Map<string, string>();
for (const kind of ["machine", "process", "filament"] as const) {
  for (const e of index[`${kind}_list`]) paths.set(`${kind}:${e.name}`, e.sub_path);
}

const cache = new Map<string, Promise<Profile>>();
function load(kind: Kind, name: string): Promise<Profile> {
  const key = `${kind}:${name}`;
  if (!cache.has(key)) {
    const subPath = paths.get(key);
    if (!subPath) throw new Error(`找不到預設：${key}`);
    const url = `${BASE}/${subPath.split("/").map(encodeURIComponent).join("/")}`;
    cache.set(
      key,
      fetch(url).then((res) => {
        if (!res.ok) throw new Error(`下載失敗 (${res.status})：${subPath}`);
        return res.json() as Promise<Profile>;
      }),
    );
  }
  return cache.get(key)!;
}

// 順序：上層預設 → include 範本（G-code 等）→ 自己的設定
async function flatten(kind: Kind, name: string): Promise<Profile> {
  const profile = await load(kind, name);
  const parent = profile.inherits ? await flatten(kind, profile.inherits) : {};
  const included = await Promise.all((profile.include ?? []).map((n) => load(kind, n)));
  return Object.assign({}, parent, ...included.map(strip), profile);
}

const strip = (p: Profile) => Object.fromEntries(Object.entries(p).filter(([key]) => !META_KEYS.includes(key)));
const compatible = (p: Profile, machine: string) =>
  Array.isArray(p.compatible_printers) && p.compatible_printers.includes(machine);

// 一次只下載幾個，避免被 GitHub 擋
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

const processNames = index.process_list.map((e) => e.name).filter((n) => /^0\.\d+mm .+ @BBL /.test(n));
const filamentNames = index.filament_list
  .map((e) => e.name)
  .filter((n) => FILAMENTS.some((f) => n.startsWith(`Bambu ${f} @BBL `)));

console.log(`下載 ${processNames.length} 個品質預設、${filamentNames.length} 個線材預設…`);
const processes = await mapLimit(processNames, 8, (n) => flatten("process", n));
const filaments = await mapLimit(filamentNames, 8, (n) => flatten("filament", n));

// 同一個層高有好幾個預設時，優先用一般的（Standard、Fine、Draft…），不用 High Quality、Strength
const processRank = (name: string) => (/High Quality|Strength|Balanced/.test(name) ? 1 : 0);

// 線材設定的值大多是字串陣列（依噴嘴類型可能有好幾個），頁面只需要第一個
const firstNumber = (config: Record<string, unknown>, key: string) => {
  const value = config[key];
  return Number(Array.isArray(value) ? value[0] : value);
};

// 清掉舊檔（官方拿掉的印表機或噴嘴不會留下來）
mkdirSync(OUTPUT_DIR, { recursive: true });
for (const file of readdirSync(OUTPUT_DIR)) {
  if (file.endsWith(".json")) rmSync(new URL(file, OUTPUT_DIR));
}
const catalog = { version: index.version, printers: [] as unknown[] };

for (const printer of PRINTERS) {
  const nozzles = [];
  for (const nozzle of NOZZLES) {
    const machineName = `${printer.label} ${nozzle} nozzle`;
    if (!paths.has(`machine:${machineName}`)) continue;
    const machine = await flatten("machine", machineName);
    // G-code 放在 include 範本裡，確認展開後跟範本一模一樣
    for (const name of machine.include ?? []) {
      const template = strip(await load("machine", name));
      for (const [key, value] of Object.entries(template)) {
        if (machine[key] !== value) throw new Error(`${machineName} 的 ${key} 跟官方範本不同`);
      }
    }
    if (!machine.include?.some((n) => n.endsWith("machine_start_gcode"))) {
      console.warn(`⚠ ${machineName} 沒有開機 G-code 範本，請確認官方預設的格式有沒有改`);
    }
    const area = (machine.printable_area as string[]).map((p) => p.split("x").map(Number));
    const bed = [Math.max(...area.map((p) => p[0])), Math.max(...area.map((p) => p[1])), Number(machine.printable_height)];

    const byHeight = new Map<number, Profile>();
    for (const p of processes.filter((p) => compatible(p, machineName))) {
      const h = Number(p.layer_height);
      const current = byHeight.get(h);
      if (!current || processRank(p.name) < processRank(current.name)) byHeight.set(h, p);
    }
    const nozzleProcesses = [...byHeight.entries()]
      .sort(([a], [b]) => a - b)
      .map(([layerHeight, p]) => ({ layerHeight, name: p.name, config: strip(p) }));

    const nozzleFilaments = FILAMENTS.flatMap((id) => {
      const match = filaments.find((f) => f.name.startsWith(`Bambu ${id} @BBL `) && compatible(f, machineName));
      return match ? [{ id, name: match.name, config: strip(match) }] : [];
    });

    const key = `${printer.id}-${nozzle}`;
    writeFileSync(
      new URL(`${key}.json`, OUTPUT_DIR),
      JSON.stringify({ machine: machineName, bed, config: strip(machine), processes: nozzleProcesses, filaments: nozzleFilaments }),
    );
    console.log(
      `${machineName}：平台 ${bed.join("×")}，層高 ${nozzleProcesses.map((p) => p.layerHeight).join("/")}，` +
        `線材 ${nozzleFilaments.length} 種（沒有：${FILAMENTS.filter((f) => !nozzleFilaments.some((p) => p.id === f)).join("、") || "無"}）`,
    );

    nozzles.push({
      diameter: Number(nozzle),
      bed,
      layerHeights: nozzleProcesses.map((p) => p.layerHeight),
      filaments: nozzleFilaments.map(({ id, config }) => ({
        id,
        nozzleTemp: firstNumber(config, "nozzle_temperature"),
        nozzleRange: [firstNumber(config, "nozzle_temperature_range_low"), firstNumber(config, "nozzle_temperature_range_high")],
        // 熱床溫度依列印板分開設定；0 代表官方不建議用這種板子
        bedTemp: {
          textured: firstNumber(config, "textured_plate_temp"),
          smooth: firstNumber(config, "hot_plate_temp"),
          cool: firstNumber(config, "cool_plate_temp"),
        },
      })),
    });
  }
  catalog.printers.push({ id: printer.id, label: printer.label, nozzles });
}

writeFileSync(CATALOG, JSON.stringify(catalog));
const files = readdirSync(OUTPUT_DIR);
console.log(`已寫入 src/data/bambu/（${files.length} 個檔案）和 bambu-catalog.json（官方預設版本 ${index.version}）`);
