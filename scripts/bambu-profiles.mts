// 下載 Bambu Studio 官方預設，展開繼承後存到 src/data/
//
//   node scripts/bambu-profiles.mts
//
// Bambu Studio 打開 3MF 時，project_settings.config 缺少的項目會用它內建的空白預設補上（不是用印表機的預設），
// 所以這裡要把每個預設沿著 inherits 一路展開成完整設定。官方預設更新時重跑一次就好
//   bambu-profiles.json：完整設定（約 600KB），只在伺服器寫 3MF 時用
//   bambu-catalog.json：頁面用的小目錄（印表機、平台尺寸、層高、線材與預設溫度）

import { writeFileSync } from "node:fs";

const BASE = "https://raw.githubusercontent.com/bambulab/BambuStudio/master/resources/profiles/BBL";
const OUTPUT = new URL("../src/data/bambu-profiles.json", import.meta.url);
const CATALOG = new URL("../src/data/bambu-catalog.json", import.meta.url);

// 第一版只做 0.4 噴嘴
const PRINTERS = [
  { id: "A1M", label: "Bambu Lab A1 mini", machine: "Bambu Lab A1 mini 0.4 nozzle" },
  { id: "A1", label: "Bambu Lab A1", machine: "Bambu Lab A1 0.4 nozzle" },
  { id: "P1P", label: "Bambu Lab P1P", machine: "Bambu Lab P1P 0.4 nozzle" },
  { id: "P1S", label: "Bambu Lab P1S", machine: "Bambu Lab P1S 0.4 nozzle" },
  { id: "X1C", label: "Bambu Lab X1 Carbon", machine: "Bambu Lab X1 Carbon 0.4 nozzle" },
  { id: "P2S", label: "Bambu Lab P2S", machine: "Bambu Lab P2S 0.4 nozzle" },
];

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

const LAYER_HEIGHTS = [0.08, 0.12, 0.16, 0.2, 0.24, 0.28];

// 只是用來描述預設本身的欄位，不是列印設定
const META_KEYS = [
  "name",
  "inherits",
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
type Profile = Record<string, unknown> & { name: string; inherits?: string };

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

async function flatten(kind: Kind, name: string): Promise<Profile> {
  const profile = await load(kind, name);
  const parent = profile.inherits ? await flatten(kind, profile.inherits) : {};
  return { ...parent, ...profile };
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

const isOtherNozzle = (name: string) => /0\.[268] nozzle/.test(name);
const processNames = index.process_list
  .map((e) => e.name)
  .filter((n) => /^0\.\d+mm .+ @BBL /.test(n) && !isOtherNozzle(n));
const filamentNames = index.filament_list
  .map((e) => e.name)
  .filter((n) => FILAMENTS.some((f) => n.startsWith(`Bambu ${f} @BBL `)) && !isOtherNozzle(n));

console.log(`下載 ${processNames.length} 個品質預設、${filamentNames.length} 個線材預設…`);
const processes = await mapLimit(processNames, 8, (n) => flatten("process", n));
const filaments = await mapLimit(filamentNames, 8, (n) => flatten("filament", n));

// 同一個層高有好幾個預設時，優先用一般的（Standard、Fine、Draft…），不用 High Quality、Strength
const processRank = (name: string) => (/High Quality|Strength/.test(name) ? 1 : 0);

// 線材設定裡的值都是只有一個元素的字串陣列，例如 nozzle_temperature: ["220"]
const firstNumber = (config: Record<string, unknown>, key: string) => {
  const value = config[key];
  return Number(Array.isArray(value) ? value[0] : value);
};

const output = {
  version: index.version,
  printers: [] as unknown[],
};
const catalog = {
  version: index.version,
  printers: [] as unknown[],
};

for (const printer of PRINTERS) {
  const machine = await flatten("machine", printer.machine);
  const area = (machine.printable_area as string[]).map((p) => p.split("x").map(Number));
  const bed = [Math.max(...area.map((p) => p[0])), Math.max(...area.map((p) => p[1])), Number(machine.printable_height)];

  const printerProcesses = LAYER_HEIGHTS.flatMap((layerHeight) => {
    const match = processes
      .filter((p) => compatible(p, printer.machine) && Number(p.layer_height) === layerHeight)
      .sort((a, b) => processRank(a.name) - processRank(b.name))[0];
    return match ? [{ layerHeight, name: match.name, config: strip(match) }] : [];
  });

  const printerFilaments = FILAMENTS.flatMap((id) => {
    const match = filaments.find((f) => f.name.startsWith(`Bambu ${id} @BBL `) && compatible(f, printer.machine));
    return match ? [{ id, name: match.name, config: strip(match) }] : [];
  });

  console.log(
    `${printer.label}：平台 ${bed.join("×")}，層高 ${printerProcesses.map((p) => p.layerHeight).join("/")}，` +
      `線材 ${printerFilaments.length} 種（沒有：${FILAMENTS.filter((f) => !printerFilaments.some((p) => p.id === f)).join("、") || "無"}）`,
  );
  output.printers.push({
    ...printer,
    bed,
    config: strip(machine),
    processes: printerProcesses,
    filaments: printerFilaments,
  });
  catalog.printers.push({
    id: printer.id,
    label: printer.label,
    bed,
    layerHeights: printerProcesses.map((p) => p.layerHeight),
    filaments: printerFilaments.map(({ id, config }) => ({
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

writeFileSync(OUTPUT, JSON.stringify(output));
writeFileSync(CATALOG, JSON.stringify(catalog, null, 2));
console.log(`已寫入 src/data/bambu-profiles.json 和 bambu-catalog.json（官方預設版本 ${index.version}）`);
