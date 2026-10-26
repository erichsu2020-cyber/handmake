// 畫畫版的繪圖核心（只在瀏覽器執行）：不碰 React，只處理 canvas
import { DRAWING_SIZE } from "@/lib/drawing-settings";

export type Point = { x: number; y: number };
export type ShapeTool = "line" | "rect" | "ellipse";

export function createCanvas(size = DRAWING_SIZE) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

export const ctx2d = (canvas: HTMLCanvasElement) => canvas.getContext("2d", { willReadFrequently: true })!;

// 筆刷：兩點之間畫一段圓頭線，連起來就是平滑的筆畫
export function strokeSegment(ctx: CanvasRenderingContext2D, from: Point, to: Point, color: string, size: number) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (from.x === to.x && from.y === to.y) {
    // 只點一下也要留下一個圓點
    ctx.beginPath();
    ctx.arc(from.x, from.y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

// 直線、矩形、圓形；square：按住 Shift 時畫正方形／正圓、直線鎖定 45° 的倍數
export function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: ShapeTool,
  start: Point,
  end: Point,
  opts: { color: string; size: number; fill: boolean; square: boolean },
) {
  let { x, y } = end;
  if (opts.square) {
    const dx = x - start.x;
    const dy = y - start.y;
    if (shape === "line") {
      const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      const length = Math.hypot(dx, dy);
      x = start.x + Math.cos(angle) * length;
      y = start.y + Math.sin(angle) * length;
    } else {
      const side = Math.max(Math.abs(dx), Math.abs(dy));
      x = start.x + Math.sign(dx || 1) * side;
      y = start.y + Math.sign(dy || 1) * side;
    }
  }

  ctx.strokeStyle = opts.color;
  ctx.fillStyle = opts.color;
  ctx.lineWidth = opts.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  if (shape === "line") {
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    return;
  }
  if (shape === "rect") {
    ctx.rect(Math.min(start.x, x), Math.min(start.y, y), Math.abs(x - start.x), Math.abs(y - start.y));
  } else {
    ctx.ellipse((start.x + x) / 2, (start.y + y) / 2, Math.abs(x - start.x) / 2, Math.abs(y - start.y) / 2, 0, 0, Math.PI * 2);
  }
  if (opts.fill) ctx.fill();
  else ctx.stroke();
}

const hexToRgb = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

// 油漆桶：從點的位置開始，把顏色相近（含透明度）且連在一起的像素填滿
// 用掃描線演算法，1024×1024 整張填滿也只要幾十毫秒
export function floodFill(canvas: HTMLCanvasElement, start: Point, color: string, alpha: number, tolerance = 32) {
  const ctx = ctx2d(canvas);
  const { width, height } = canvas;
  const x0 = Math.floor(start.x);
  const y0 = Math.floor(start.y);
  if (x0 < 0 || y0 < 0 || x0 >= width || y0 >= height) return false;

  const image = ctx.getImageData(0, 0, width, height);
  const data = image.data;
  const startIndex = (y0 * width + x0) * 4;
  const target = [data[startIndex], data[startIndex + 1], data[startIndex + 2], data[startIndex + 3]];
  const [r, g, b] = hexToRgb(color);
  const a = Math.round(alpha * 255);
  // 點的地方已經是這個顏色就不用填
  if (target[0] === r && target[1] === g && target[2] === b && target[3] === a) return false;

  const matches = (i: number) =>
    Math.abs(data[i] - target[0]) <= tolerance &&
    Math.abs(data[i + 1] - target[1]) <= tolerance &&
    Math.abs(data[i + 2] - target[2]) <= tolerance &&
    Math.abs(data[i + 3] - target[3]) <= tolerance;
  const filled = new Uint8Array(width * height);
  const stack: number[] = [x0, y0];

  while (stack.length > 0) {
    const y = stack.pop()!;
    let x = stack.pop()!;
    // 往左找到這一段的起點
    while (x > 0 && !filled[y * width + x - 1] && matches((y * width + x - 1) * 4)) x--;
    let spanAbove = false;
    let spanBelow = false;
    for (; x < width; x++) {
      const p = y * width + x;
      if (filled[p] || !matches(p * 4)) break;
      filled[p] = 1;
      const i = p * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
      // 上下兩排各記一個新的起點
      for (const [ny, isAbove] of [[y - 1, true], [y + 1, false]] as const) {
        if (ny < 0 || ny >= height) continue;
        const np = ny * width + x;
        const open = !filled[np] && matches(np * 4);
        const inSpan = isAbove ? spanAbove : spanBelow;
        if (open && !inSpan) stack.push(x, ny);
        if (isAbove) spanAbove = open;
        else spanBelow = open;
      }
    }
  }
  ctx.putImageData(image, 0, 0);
  return true;
}

// 文字：font 用系統內建字型，中文也能正常顯示
export function drawText(ctx: CanvasRenderingContext2D, text: string, at: Point, color: string, size: number) {
  ctx.fillStyle = color;
  ctx.font = `${size}px "Noto Sans TC", "Microsoft JhengHei", "PingFang TC", sans-serif`;
  ctx.textBaseline = "top";
  text.split("\n").forEach((line, i) => ctx.fillText(line, at.x, at.y + i * size * 1.2));
}

// 圖片縮放到放得進畫布（不裁切），置中
export function drawImageContain(ctx: CanvasRenderingContext2D, image: CanvasImageSource & { width: number; height: number }) {
  const size = ctx.canvas.width;
  const scale = Math.min(size / image.width, size / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
}

// 讀取 Blob 上的圖片（要 crossOrigin，畫進 canvas 後才能再匯出）
export function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("讀取圖片失敗"));
    image.src = src;
  });
}

export function canvasToPng(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("匯出圖片失敗"))), "image/png"),
  );
}

export type CompositeLayer = { canvas: HTMLCanvasElement; visible: boolean; opacity: number };

// 把可見的圖層由下往上合併；background 為 null 時保留透明
export function composite(target: HTMLCanvasElement, layers: CompositeLayer[], background: string | null = "#ffffff") {
  const ctx = target.getContext("2d")!;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.clearRect(0, 0, target.width, target.height);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, target.width, target.height);
  }
  for (const layer of layers) {
    if (!layer.visible || layer.opacity === 0) continue;
    ctx.globalAlpha = layer.opacity;
    ctx.drawImage(layer.canvas, 0, 0);
  }
  ctx.restore();
}
