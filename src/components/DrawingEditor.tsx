"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import {
  canvasToPng,
  composite,
  createCanvas,
  ctx2d,
  drawImageContain,
  drawShape,
  drawText,
  floodFill,
  loadImage,
  strokeSegment,
  type Point,
  type ShapeTool,
} from "@/lib/drawing-engine";
import { DRAWING_FOLDER, DRAWING_SIZE, MAX_LAYERS, MAX_LAYER_NAME_LENGTH, MAX_TITLE_LENGTH } from "@/lib/drawing-settings";

// 畫畫版：每個圖層是一張獨立的 canvas（1024×1024），畫面上的 canvas 只負責把圖層合併顯示
// 筆畫和形狀先畫在暫存的 strokeCanvas，放開滑鼠才寫進圖層，所以半透明筆畫的深淺會一致、形狀可以拖曳調整

type Tool = "brush" | "eraser" | ShapeTool | "bucket" | "eyedropper" | "text";

type Layer = {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
  canvas: HTMLCanvasElement;
  // 已經存在 Blob 上、而且之後沒再改過的話，儲存時直接沿用這個網址
  url?: string;
  // 每次改到像素就 +1；儲存期間又被改過的圖層，存完不能標成「已儲存」
  version: number;
};

// 復原紀錄：記的是「怎麼還原」，還原後再產生反向的紀錄放進重做
type HistoryEntry =
  | { type: "pixels"; layerId: string; image: ImageData }
  | { type: "insert"; layer: Layer; index: number } // 還原 = 移除這個圖層
  | { type: "remove"; layer: Layer; index: number }; // 還原 = 把圖層放回去

const MAX_HISTORY = 30;

const TOOLS: { value: Tool; label: string; icon: string; key: string }[] = [
  { value: "brush", label: "畫筆", icon: "✏️", key: "B" },
  { value: "eraser", label: "橡皮擦", icon: "🧽", key: "E" },
  { value: "line", label: "直線", icon: "／", key: "L" },
  { value: "rect", label: "矩形", icon: "▭", key: "R" },
  { value: "ellipse", label: "圓形", icon: "◯", key: "O" },
  { value: "bucket", label: "油漆桶", icon: "🪣", key: "G" },
  { value: "eyedropper", label: "吸管", icon: "💧", key: "I" },
  { value: "text", label: "文字", icon: "🔤", key: "T" },
];

const PALETTE = [
  "#000000", "#4b5563", "#9ca3af", "#ffffff", "#ef4444", "#f97316", "#facc15", "#22c55e",
  "#14b8a6", "#3b82f6", "#6366f1", "#a855f7", "#ec4899", "#92400e", "#f5d0b0", "#c68642",
];

const isShape = (tool: Tool): tool is ShapeTool => tool === "line" || tool === "rect" || tool === "ellipse";
const newId = () => Math.random().toString(36).slice(2, 10);
const toHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;

export type DrawingEditorInitial = {
  id: string;
  title: string;
  layers: { name: string; visible: boolean; opacity: number; url: string }[];
};

function makeLayer(name: string, fill?: string): Layer {
  const canvas = createCanvas();
  if (fill) {
    const ctx = ctx2d(canvas);
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  return { id: newId(), name, visible: true, opacity: 1, canvas, version: 0 };
}

function initialLayers(initial?: DrawingEditorInitial): Layer[] {
  if (!initial) return [makeLayer("背景", "#ffffff"), makeLayer("圖層 1")];
  // 圖片之後才讀進來（見下面的 useEffect）
  return initial.layers.map((l) => ({ ...makeLayer(l.name), visible: l.visible, opacity: l.opacity, url: l.url }));
}

export default function DrawingEditor({ initial }: { initial?: DrawingEditorInitial }) {
  const displayRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [layers, setLayersState] = useState<Layer[]>(() => initialLayers(initial));
  // 事件處理裡要拿到最新的圖層（連續復原時 state 還沒更新），所以另外存一份
  const layersRef = useRef(layers);
  const [activeId, setActiveId] = useState(() => layers[layers.length - 1].id);
  const [drawingId, setDrawingId] = useState(initial?.id);
  const [title, setTitle] = useState(initial?.title ?? "");

  const [tool, setTool] = useState<Tool>("brush");
  const [color, setColor] = useState("#000000");
  const [size, setSize] = useState(8);
  const [alpha, setAlpha] = useState(1);
  const [fillShape, setFillShape] = useState(false);
  const [fontSize, setFontSize] = useState(48);
  const [text, setText] = useState("");

  const undoRef = useRef<HistoryEntry[]>([]);
  const redoRef = useRef<HistoryEntry[]>([]);
  const [historySize, setHistorySize] = useState({ undo: 0, redo: 0 });

  const [loading, setLoading] = useState(Boolean(initial));
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  // 每次有任何修改就 +1，用來判斷儲存期間有沒有又被改過
  const changeRef = useRef(0);
  const [message, setMessage] = useState<{ type: "error" | "ok"; text: string } | null>(null);

  // 正在畫的這一筆
  const strokeRef = useRef<HTMLCanvasElement | null>(null);
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const gestureRef = useRef<{ tool: Tool; layerId: string; start: Point; last: Point; before: ImageData } | null>(
    null,
  );

  const setLayers = useCallback((next: Layer[]) => {
    layersRef.current = next;
    setLayersState(next);
  }, []);

  const markChanged = useCallback(() => {
    changeRef.current++;
    setDirty(true);
  }, []);

  // redraw 是固定的函式，透明度用 ref 讀最新值
  const alphaRef = useRef(alpha);
  useEffect(() => {
    alphaRef.current = alpha;
  }, [alpha]);

  // 把圖層合併畫到畫面上；正在畫的筆畫疊在作用中的圖層上預覽
  const redraw = useCallback(() => {
    const display = displayRef.current;
    if (!display) return;
    const ctx = display.getContext("2d")!;
    ctx.clearRect(0, 0, display.width, display.height);
    const gesture = gestureRef.current;
    for (const layer of layersRef.current) {
      if (!layer.visible || layer.opacity === 0) continue;
      let source = layer.canvas;
      if (gesture && gesture.layerId === layer.id && strokeRef.current) {
        scratchRef.current ??= createCanvas();
        const scratch = ctx2d(scratchRef.current);
        scratch.globalCompositeOperation = "source-over";
        scratch.globalAlpha = 1;
        scratch.clearRect(0, 0, DRAWING_SIZE, DRAWING_SIZE);
        scratch.drawImage(layer.canvas, 0, 0);
        scratch.globalCompositeOperation = gesture.tool === "eraser" ? "destination-out" : "source-over";
        scratch.globalAlpha = alphaRef.current;
        scratch.drawImage(strokeRef.current, 0, 0);
        source = scratchRef.current;
      }
      ctx.globalAlpha = layer.opacity;
      ctx.drawImage(source, 0, 0);
    }
    ctx.globalAlpha = 1;
  }, []);

  useEffect(() => {
    redraw();
  }, [layers, redraw]);

  // 打開舊畫作：把每個圖層的 PNG 讀進對應的 canvas
  useEffect(() => {
    if (!initial) return;
    let cancelled = false;
    Promise.all(
      initial.layers.map(async (l, i) => {
        const image = await loadImage(l.url);
        if (!cancelled) ctx2d(layersRef.current[i].canvas).drawImage(image, 0, 0);
      }),
    )
      .then(() => {
        if (cancelled) return;
        setLoading(false);
        redraw();
      })
      .catch(() => {
        if (!cancelled) setMessage({ type: "error", text: "讀取畫作失敗，請重新整理頁面再試一次" });
      });
    return () => {
      cancelled = true;
    };
  }, [initial, redraw]);

  // 還沒儲存就關頁面時提醒
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  // ---------- 復原／重做 ----------

  const pushHistory = useCallback(
    (entry: HistoryEntry) => {
      undoRef.current.push(entry);
      if (undoRef.current.length > MAX_HISTORY) undoRef.current.shift();
      redoRef.current = [];
      setHistorySize({ undo: undoRef.current.length, redo: 0 });
      markChanged();
    },
    [markChanged],
  );

  // 像素改過的圖層：版本 +1、不能再沿用舊網址
  const touchLayer = useCallback(
    (layerId: string) => {
      setLayers(layersRef.current.map((l) => (l.id === layerId ? { ...l, url: undefined, version: l.version + 1 } : l)));
    },
    [setLayers],
  );

  const revert = useCallback(
    (entry: HistoryEntry): HistoryEntry | null => {
      const list = layersRef.current;
      switch (entry.type) {
        case "pixels": {
          const layer = list.find((l) => l.id === entry.layerId);
          if (!layer) return null;
          const ctx = ctx2d(layer.canvas);
          const current = ctx.getImageData(0, 0, DRAWING_SIZE, DRAWING_SIZE);
          ctx.putImageData(entry.image, 0, 0);
          touchLayer(layer.id);
          return { type: "pixels", layerId: layer.id, image: current };
        }
        case "insert": {
          const next = list.filter((l) => l.id !== entry.layer.id);
          setLayers(next);
          setActiveId((id) => (id === entry.layer.id ? next[Math.min(entry.index, next.length - 1)].id : id));
          return { type: "remove", layer: entry.layer, index: entry.index };
        }
        case "remove": {
          const next = [...list];
          next.splice(entry.index, 0, entry.layer);
          setLayers(next);
          setActiveId(entry.layer.id);
          return { type: "insert", layer: entry.layer, index: entry.index };
        }
      }
    },
    [setLayers, touchLayer],
  );

  const undo = useCallback(() => {
    const entry = undoRef.current.pop();
    if (!entry) return;
    const inverse = revert(entry);
    if (inverse) redoRef.current.push(inverse);
    setHistorySize({ undo: undoRef.current.length, redo: redoRef.current.length });
    markChanged();
    redraw();
  }, [revert, markChanged, redraw]);

  const redo = useCallback(() => {
    const entry = redoRef.current.pop();
    if (!entry) return;
    const inverse = revert(entry);
    if (inverse) undoRef.current.push(inverse);
    setHistorySize({ undo: undoRef.current.length, redo: redoRef.current.length });
    markChanged();
    redraw();
  }, [revert, markChanged, redraw]);

  // ---------- 畫圖 ----------

  const activeLayer = layers.find((l) => l.id === activeId) ?? layers[layers.length - 1];

  function toPoint(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * DRAWING_SIZE) / rect.width,
      y: ((e.clientY - rect.top) * DRAWING_SIZE) / rect.height,
    };
  }

  // 一次性的修改（油漆桶、文字、清除）：先記下原本的樣子，再改
  function editLayer(layer: Layer, edit: (ctx: CanvasRenderingContext2D) => boolean | void) {
    const ctx = ctx2d(layer.canvas);
    const before = ctx.getImageData(0, 0, DRAWING_SIZE, DRAWING_SIZE);
    if (edit(ctx) === false) return;
    pushHistory({ type: "pixels", layerId: layer.id, image: before });
    touchLayer(layer.id);
    redraw();
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (loading || saving || e.button !== 0) return;
    const point = toPoint(e);
    const layer = activeLayer;
    setMessage(null);

    if (tool === "eyedropper") {
      // 吸取畫面上看到的顏色（所有圖層合併後）；透明的地方當作白色
      const [r, g, b, a] = displayRef.current!.getContext("2d")!.getImageData(Math.floor(point.x), Math.floor(point.y), 1, 1).data;
      setColor(a === 0 ? "#ffffff" : toHex(r, g, b));
      setTool("brush");
      return;
    }
    if (!layer.visible) {
      setMessage({ type: "error", text: `「${layer.name}」目前隱藏中，請先顯示它再畫` });
      return;
    }
    if (tool === "bucket") {
      editLayer(layer, () => floodFill(layer.canvas, point, color, alpha));
      return;
    }
    if (tool === "text") {
      if (!text.trim()) {
        setMessage({ type: "error", text: "請先在上方輸入要放的文字，再點畫布" });
        return;
      }
      editLayer(layer, (ctx) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        drawText(ctx, text, point, color, fontSize);
        ctx.restore();
      });
      return;
    }

    // 畫筆、橡皮擦、形狀：開始一筆
    e.currentTarget.setPointerCapture(e.pointerId);
    strokeRef.current ??= createCanvas();
    const stroke = ctx2d(strokeRef.current);
    stroke.clearRect(0, 0, DRAWING_SIZE, DRAWING_SIZE);
    gestureRef.current = {
      tool,
      layerId: layer.id,
      start: point,
      last: point,
      before: ctx2d(layer.canvas).getImageData(0, 0, DRAWING_SIZE, DRAWING_SIZE),
    };
    if (tool === "brush" || tool === "eraser") strokeSegment(stroke, point, point, color, size);
    redraw();
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    const gesture = gestureRef.current;
    if (!gesture || !strokeRef.current) return;
    const point = toPoint(e);
    const stroke = ctx2d(strokeRef.current);
    if (gesture.tool === "brush" || gesture.tool === "eraser") {
      strokeSegment(stroke, gesture.last, point, color, size);
    } else if (isShape(gesture.tool)) {
      stroke.clearRect(0, 0, DRAWING_SIZE, DRAWING_SIZE);
      drawShape(stroke, gesture.tool, gesture.start, point, { color, size, fill: fillShape, square: e.shiftKey });
    }
    gesture.last = point;
    redraw();
  }

  function handlePointerUp() {
    const gesture = gestureRef.current;
    if (!gesture || !strokeRef.current) return;
    gestureRef.current = null;
    const layer = layersRef.current.find((l) => l.id === gesture.layerId);
    if (layer) {
      const ctx = ctx2d(layer.canvas);
      ctx.save();
      ctx.globalCompositeOperation = gesture.tool === "eraser" ? "destination-out" : "source-over";
      ctx.globalAlpha = alpha;
      ctx.drawImage(strokeRef.current, 0, 0);
      ctx.restore();
      pushHistory({ type: "pixels", layerId: layer.id, image: gesture.before });
      touchLayer(layer.id);
    }
    redraw();
  }

  // ---------- 圖層 ----------

  function addLayer(layer = makeLayer(`圖層 ${layers.length}`)) {
    if (layers.length >= MAX_LAYERS) {
      setMessage({ type: "error", text: `圖層最多 ${MAX_LAYERS} 個` });
      return null;
    }
    const index = layers.findIndex((l) => l.id === activeLayer.id) + 1;
    const next = [...layersRef.current];
    next.splice(index, 0, layer);
    setLayers(next);
    setActiveId(layer.id);
    pushHistory({ type: "insert", layer, index });
    return layer;
  }

  function deleteLayer() {
    if (layers.length <= 1) {
      setMessage({ type: "error", text: "至少要留一個圖層" });
      return;
    }
    const index = layers.findIndex((l) => l.id === activeLayer.id);
    const next = layersRef.current.filter((l) => l.id !== activeLayer.id);
    setLayers(next);
    setActiveId(next[Math.max(0, index - 1)].id);
    pushHistory({ type: "remove", layer: activeLayer, index });
  }

  // 改名、顯示、不透明度、順序：不需要重新上傳圖片，也不放進復原紀錄（直接改回來就好）
  function updateLayer(id: string, patch: Partial<Pick<Layer, "name" | "visible" | "opacity">>) {
    setLayers(layersRef.current.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    markChanged();
  }

  function moveLayer(direction: 1 | -1) {
    const list = [...layersRef.current];
    const index = list.findIndex((l) => l.id === activeLayer.id);
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    setLayers(list);
    markChanged();
  }

  function clearLayer() {
    if (!window.confirm(`確定要清除「${activeLayer.name}」的內容嗎？可以按「復原」救回來。`)) return;
    editLayer(activeLayer, (ctx) => ctx.clearRect(0, 0, DRAWING_SIZE, DRAWING_SIZE));
  }

  async function importImage(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMessage({ type: "error", text: "請選擇圖片檔" });
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    try {
      const image = await loadImage(objectUrl);
      const layer = makeLayer(file.name.replace(/\.[^.]+$/, "").slice(0, MAX_LAYER_NAME_LENGTH) || "匯入的圖片");
      drawImageContain(ctx2d(layer.canvas), image);
      if (addLayer(layer)) setMessage({ type: "ok", text: "已匯入到新圖層，可以調低不透明度當成底圖描繪" });
    } catch {
      setMessage({ type: "error", text: "讀取圖片失敗" });
    } finally {
      URL.revokeObjectURL(objectUrl);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // ---------- 儲存與下載 ----------

  function mergedCanvas() {
    const canvas = createCanvas();
    composite(canvas, layersRef.current, "#ffffff");
    return canvas;
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    const startedAt = changeRef.current;
    const list = layersRef.current;
    try {
      // 檔案直接從瀏覽器上傳到 Vercel Blob；沒改過的圖層沿用原本的網址
      const put = async (canvas: HTMLCanvasElement, name: string) =>
        (
          await upload(`${DRAWING_FOLDER}${name}.png`, await canvasToPng(canvas), {
            access: "public",
            handleUploadUrl: "/api/blob-upload",
            contentType: "image/png",
          })
        ).url;
      const [previewUrl, ...urls] = await Promise.all([
        put(mergedCanvas(), "preview"),
        ...list.map((l) => l.url ?? put(l.canvas, "layer")),
      ]);

      const res = await fetch(drawingId ? `/api/drawings/${drawingId}` : "/api/drawings", {
        method: drawingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          previewUrl,
          layers: list.map((l, i) => ({ name: l.name, visible: l.visible, opacity: l.opacity, url: urls[i] })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "儲存失敗");

      // 儲存期間沒再改過的圖層，之後就沿用剛上傳的網址
      const saved = new Map(list.map((l, i) => [l.id, { version: l.version, url: urls[i] }]));
      setLayers(
        layersRef.current.map((l) => {
          const s = saved.get(l.id);
          return s && s.version === l.version ? { ...l, url: s.url } : l;
        }),
      );
      if (!drawingId) {
        setDrawingId(data.drawing.id);
        // 換成這張畫作的網址，重新整理也能回來；不重新載入頁面
        window.history.replaceState(null, "", `/draw/${data.drawing.id}`);
      }
      if (changeRef.current === startedAt) setDirty(false);
      setMessage({ type: "ok", text: "已儲存" });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "儲存失敗" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDownload() {
    const blob = await canvasToPng(mergedCanvas());
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.trim() || "未命名畫作"}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ---------- 快捷鍵 ----------

  // 監聽器只註冊一次，透過 ref 呼叫最新的函式
  const shortcutRef = useRef({ undo, redo, setTool, setSize });
  useEffect(() => {
    shortcutRef.current = { undo, redo, setTool, setSize };
  }, [undo, redo]);
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // 正在輸入框打字時不觸發快捷鍵
      if (e.target instanceof Element && e.target.closest("input, textarea, select")) return;
      const s = shortcutRef.current;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === "y") {
        e.preventDefault();
        s.redo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = TOOLS.find((t) => t.key.toLowerCase() === key);
      if (t) s.setTool(t.value);
      if (key === "[") s.setSize((v) => Math.max(1, v - 2));
      if (key === "]") s.setSize((v) => Math.min(100, v + 2));
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // ---------- 畫面 ----------

  const button = "rounded-lg border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-40 dark:border-zinc-700";
  const busy = loading || saving;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            markChanged();
          }}
          maxLength={MAX_TITLE_LENGTH}
          placeholder="未命名畫作"
          className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent p-2 font-medium dark:border-zinc-700"
        />
        <span className="text-sm text-zinc-500">{loading ? "讀取中…" : saving ? "儲存中…" : dirty ? "尚未儲存" : "已儲存"}</span>
        <button type="button" onClick={handleDownload} disabled={busy} className={button}>
          下載 PNG
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={busy}
          className="rounded-lg bg-foreground px-4 py-1.5 text-sm font-medium text-background disabled:opacity-40"
        >
          儲存
        </button>
      </div>

      {message && (
        <p
          className={`rounded-lg p-3 text-sm ${
            message.type === "error" ? "bg-red-100 text-red-700" : "bg-green-100 text-green-800"
          }`}
        >
          {message.text}
        </p>
      )}

      {/* 工具 */}
      <div className="flex flex-wrap items-center gap-1.5">
        {TOOLS.map((t) => (
          <button
            key={t.value}
            type="button"
            title={`${t.label}（${t.key}）`}
            onClick={() => setTool(t.value)}
            className={`flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-sm ${
              tool === t.value ? "border-foreground bg-foreground text-background" : "border-zinc-300 dark:border-zinc-700"
            }`}
          >
            <span aria-hidden>{t.icon}</span>
            {t.label}
          </button>
        ))}
        <span className="mx-1 h-6 w-px bg-zinc-300 dark:bg-zinc-700" />
        <button type="button" onClick={undo} disabled={historySize.undo === 0 || busy} title="復原（Ctrl+Z）" className={button}>
          ↶ 復原
        </button>
        <button type="button" onClick={redo} disabled={historySize.redo === 0 || busy} title="重做（Ctrl+Y）" className={button}>
          ↷ 重做
        </button>
      </div>

      {/* 工具選項 */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-zinc-300 p-3 text-sm dark:border-zinc-700">
        <div className="flex flex-wrap items-center gap-1.5">
          {PALETTE.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={c}
              onClick={() => setColor(c)}
              style={{ backgroundColor: c }}
              className={`h-6 w-6 rounded-full border ${color === c ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : "border-zinc-300"}`}
            />
          ))}
          <label className="flex items-center gap-1 pl-1">
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-7 w-9 cursor-pointer bg-transparent" />
            自訂
          </label>
        </div>

        {tool === "text" ? (
          <>
            <label className="flex flex-1 items-center gap-2">
              文字
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="輸入文字後點畫布放置"
                className="min-w-0 flex-1 rounded-lg border border-zinc-300 bg-transparent p-1.5 dark:border-zinc-700"
              />
            </label>
            <label className="flex items-center gap-2">
              字級
              <input type="range" min={12} max={200} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} />
              <span className="w-12 text-zinc-500">{fontSize}px</span>
            </label>
          </>
        ) : (
          tool !== "bucket" &&
          tool !== "eyedropper" && (
            <label className="flex items-center gap-2">
              粗細
              <input type="range" min={1} max={100} value={size} onChange={(e) => setSize(Number(e.target.value))} />
              <span className="w-10 text-zinc-500">{size}px</span>
            </label>
          )
        )}

        {tool !== "eyedropper" && (
          <label className="flex items-center gap-2">
            透明度
            <input
              type="range"
              min={5}
              max={100}
              step={5}
              value={Math.round(alpha * 100)}
              onChange={(e) => setAlpha(Number(e.target.value) / 100)}
            />
            <span className="w-10 text-zinc-500">{Math.round(alpha * 100)}%</span>
          </label>
        )}

        {(tool === "rect" || tool === "ellipse") && (
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={fillShape} onChange={(e) => setFillShape(e.target.checked)} className="h-4 w-4" />
            實心
          </label>
        )}
        {isShape(tool) && <span className="text-zinc-500">按住 Shift：{tool === "line" ? "鎖定 45° 角" : "正方形／正圓"}</span>}
        {tool === "bucket" && <span className="text-zinc-500">點一下，把相連的同色區域填滿（只填目前的圖層）</span>}
        {tool === "eyedropper" && <span className="text-zinc-500">點畫布上的顏色，吸取後會切回畫筆</span>}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* 畫布：棋盤格背景代表透明 */}
        <div className="relative min-w-0 flex-1">
          <canvas
            ref={displayRef}
            width={DRAWING_SIZE}
            height={DRAWING_SIZE}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className={`aspect-square w-full touch-none rounded-lg border border-zinc-300 dark:border-zinc-700 ${
              tool === "eyedropper" ? "cursor-copy" : tool === "text" ? "cursor-text" : "cursor-crosshair"
            }`}
            style={{
              backgroundColor: "#fff",
              backgroundImage:
                "linear-gradient(45deg,#e5e5e5 25%,transparent 25%),linear-gradient(-45deg,#e5e5e5 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#e5e5e5 75%),linear-gradient(-45deg,transparent 75%,#e5e5e5 75%)",
              backgroundSize: "20px 20px",
              backgroundPosition: "0 0,0 10px,10px -10px,-10px 0",
            }}
          />
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/70 text-sm">讀取畫作中…</div>
          )}
        </div>

        {/* 圖層面板：上面的圖層蓋在下面的圖層上 */}
        <aside className="flex w-full shrink-0 flex-col gap-3 rounded-lg border border-zinc-300 p-3 text-sm lg:w-64 dark:border-zinc-700">
          <div className="flex items-center justify-between">
            <span className="font-medium">
              圖層（{layers.length}/{MAX_LAYERS}）
            </span>
            <div className="flex gap-1">
              <button type="button" onClick={() => addLayer()} disabled={busy} title="新增圖層" className={button}>
                ＋
              </button>
              <button type="button" onClick={deleteLayer} disabled={busy} title="刪除圖層" className={button}>
                🗑
              </button>
            </div>
          </div>

          <ul className="flex flex-col gap-1">
            {[...layers].reverse().map((l) => (
              <li
                key={l.id}
                onClick={() => setActiveId(l.id)}
                className={`flex cursor-pointer items-center gap-2 rounded-lg border p-1.5 ${
                  l.id === activeLayer.id ? "border-foreground bg-foreground/5" : "border-transparent"
                }`}
              >
                <button
                  type="button"
                  aria-label={l.visible ? "隱藏圖層" : "顯示圖層"}
                  onClick={(e) => {
                    e.stopPropagation();
                    updateLayer(l.id, { visible: !l.visible });
                  }}
                  className={`w-6 shrink-0 ${l.visible ? "" : "opacity-30"}`}
                >
                  👁
                </button>
                <input
                  value={l.name}
                  maxLength={MAX_LAYER_NAME_LENGTH}
                  onChange={(e) => updateLayer(l.id, { name: e.target.value })}
                  onFocus={() => setActiveId(l.id)}
                  className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-zinc-300 focus:border-zinc-400 dark:hover:border-zinc-700"
                />
              </li>
            ))}
          </ul>

          <label className="flex flex-col gap-1">
            <span>不透明度：{Math.round(activeLayer.opacity * 100)}%</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={Math.round(activeLayer.opacity * 100)}
              onChange={(e) => updateLayer(activeLayer.id, { opacity: Number(e.target.value) / 100 })}
            />
          </label>

          <div className="flex flex-wrap gap-1">
            <button type="button" onClick={() => moveLayer(1)} disabled={busy} className={button}>
              ↑ 上移
            </button>
            <button type="button" onClick={() => moveLayer(-1)} disabled={busy} className={button}>
              ↓ 下移
            </button>
            <button type="button" onClick={clearLayer} disabled={busy} className={button}>
              清除圖層
            </button>
          </div>

          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className={button}>
            🖼 匯入圖片到新圖層
          </button>
          <input ref={fileRef} type="file" accept="image/*" onChange={(e) => importImage(e.target.files?.[0])} className="hidden" />

          <p className="text-xs text-zinc-500">
            快捷鍵：{TOOLS.map((t) => `${t.key} ${t.label}`).join("、")}、[ ] 調整粗細、Ctrl+Z 復原、Ctrl+Y 重做
          </p>
        </aside>
      </div>
    </div>
  );
}
