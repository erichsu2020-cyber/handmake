import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// 密碼加密：scrypt（Node 內建，刻意算得很慢，讓暴力破解很花時間）＋每個帳號各自的隨機鹽
// 存成「scrypt$N$r$p$鹽$雜湊」，之後要調高強度時，舊密碼也還能驗證
// 這個檔案不能用 @/ 路徑，因為 scripts/user.mts 也會直接載入它

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 64;
const MAXMEM = 128 * 1024 * 1024;

function derive(password: string, salt: Buffer, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { ...options, maxmem: MAXMEM }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string) {
  const [algorithm, n, r, p, salt, hash] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const actual = await derive(password, Buffer.from(salt, "base64"), { N: Number(n), r: Number(r), p: Number(p) });
  // 固定時間比對，避免從回應時間猜出密碼
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const MIN_PASSWORD_LENGTH = 8;
