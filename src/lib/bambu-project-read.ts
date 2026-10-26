import { strFromU8, unzipSync } from "fflate";
import type { MeshData } from "@/lib/mesh";

// 讀取 Bambu Studio 的 3MF 專案（網站產生的，或 Bambu Studio 自己存的）：模型（套用所有位移／旋轉）、設定、盤面縮圖
// 瀏覽器和伺服器共用：頁面用它拍模型截圖，伺服器用它分析，兩邊看到的模型完全一樣
// Bambu Studio 存的專案會把網格放在 3D/Objects/*.model，主檔用 component 引用，每層都可能有位移／旋轉

export type Config = Record<string, unknown>;
// 3MF 的變換矩陣：12 個數字，前 9 個是 3×3、最後 3 個是位移；點 × 矩陣（列向量在左）
type Matrix = number[];
const IDENTITY: Matrix = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

const UNIT_MM: Record<string, number> = { micron: 0.001, millimeter: 1, centimeter: 10, meter: 1000, inch: 25.4, foot: 304.8 };

const attrs = (text: string) => Object.fromEntries([...text.matchAll(/([\w:]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

function parseMatrix(text: string | undefined): Matrix {
  if (!text) return IDENTITY;
  const m = text.trim().split(/\s+/).map(Number);
  return m.length === 12 && m.every(Number.isFinite) ? m : IDENTITY;
}

// 先套 a 再套 b
function multiply(a: Matrix, b: Matrix): Matrix {
  const r = new Array(12).fill(0);
  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 3; col++) {
      let sum = row === 3 ? b[9 + col] : 0;
      for (let k = 0; k < 3; k++) sum += (row === 3 ? a[9 + k] : a[row * 3 + k]) * b[k * 3 + col];
      r[row * 3 + col] = sum;
    }
  }
  return r;
}

type ParsedObject = { mesh?: { positions: Float32Array; indices: Uint32Array }; components: { objectId: string; path?: string; transform: Matrix }[] };

function parseModelFile(xml: string) {
  const unit = UNIT_MM[attrs(xml.match(/<model\b([^>]*)>/)?.[1] ?? "").unit ?? "millimeter"] ?? 1;
  const objects = new Map<string, ParsedObject>();
  for (const [, head, body] of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const id = attrs(head).id;
    const meshBody = body.match(/<mesh>([\s\S]*?)<\/mesh>/)?.[1];
    const object: ParsedObject = { components: [] };
    if (meshBody) {
      const vertices = [...meshBody.matchAll(/<vertex\s+x="([^"]+)"\s+y="([^"]+)"\s+z="([^"]+)"/g)];
      const triangles = [...meshBody.matchAll(/<triangle\s+v1="(\d+)"\s+v2="(\d+)"\s+v3="(\d+)"/g)];
      object.mesh = {
        positions: Float32Array.from(vertices.flatMap((m) => [Number(m[1]) * unit, Number(m[2]) * unit, Number(m[3]) * unit])),
        indices: Uint32Array.from(triangles.flatMap((m) => [Number(m[1]), Number(m[2]), Number(m[3])])),
      };
    }
    for (const [, c] of body.matchAll(/<component\b([^>]*?)\/?>/g)) {
      const a = attrs(c);
      object.components.push({ objectId: a.objectid, path: a["p:path"] ?? a.path, transform: parseMatrix(a.transform) });
    }
    objects.set(id, object);
  }
  const items = [...xml.matchAll(/<item\b([^>]*?)\/?>/g)].map(([, text]) => {
    const a = attrs(text);
    return { objectId: a.objectid, transform: parseMatrix(a.transform), printable: a.printable !== "0" };
  });
  return { objects, items, unit };
}

export type BambuProject = {
  files: Record<string, Uint8Array>;
  config: Config | null;
  meshes: MeshData[];
  // 有幾個物件（build item），不是網格數
  objectCount: number;
  // Bambu Studio 存檔時附的盤面縮圖（PNG），網站產生的檔案沒有
  thumbnail?: Uint8Array;
};

export function readBambuProject(input: Uint8Array): BambuProject {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(input);
  } catch {
    throw new Error("不是有效的 3MF 檔（無法解壓縮）");
  }
  const rels = files["_rels/.rels"] ? strFromU8(files["_rels/.rels"]) : "";
  const rootPath = (rels.match(/Target="\/?([^"]+\.model)"/)?.[1] ?? "3D/3dmodel.model").replace(/^\//, "");
  if (!files[rootPath]) throw new Error("3MF 裡找不到模型檔");

  const cache = new Map<string, ReturnType<typeof parseModelFile>>();
  const load = (path: string) => {
    const key = path.replace(/^\//, "");
    if (!cache.has(key)) {
      if (!files[key]) throw new Error(`3MF 缺少模型檔 ${key}`);
      cache.set(key, parseModelFile(strFromU8(files[key])));
    }
    return cache.get(key)!;
  };

  const meshes: MeshData[] = [];
  const resolve = (path: string, objectId: string, matrix: Matrix, depth: number) => {
    if (depth > 10) throw new Error("3MF 的物件引用層數太深");
    const object = load(path).objects.get(objectId);
    if (!object) return;
    if (object.mesh && object.mesh.indices.length > 0) {
      const src = object.mesh.positions;
      const positions = new Float32Array(src.length);
      for (let i = 0; i < src.length; i += 3) {
        const [x, y, z] = [src[i], src[i + 1], src[i + 2]];
        for (let k = 0; k < 3; k++) positions[i + k] = x * matrix[k] + y * matrix[3 + k] + z * matrix[6 + k] + matrix[9 + k];
      }
      meshes.push({ positions, indices: object.mesh.indices });
    }
    for (const c of object.components) resolve(c.path ?? path, c.objectId, multiply(c.transform, matrix), depth + 1);
  };

  const root = load(rootPath);
  const items = root.items.filter((i) => i.printable);
  for (const item of items) resolve(rootPath, item.objectId, item.transform, 0);
  if (meshes.length === 0) throw new Error("3MF 裡沒有可列印的模型");

  let config: Config | null = null;
  if (files["Metadata/project_settings.config"]) {
    try {
      config = JSON.parse(strFromU8(files["Metadata/project_settings.config"]));
    } catch {
      throw new Error("Bambu 設定檔（project_settings.config）格式不正確");
    }
  }
  return { files, config, meshes, objectCount: items.length, thumbnail: files["Metadata/plate_1.png"] };
}
