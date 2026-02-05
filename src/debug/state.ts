// デバッグ状態の単一判定を提供するモジュール
// - 起動時に setDebug() で最終状態を確定する。enabled/file。
// - 以降は isDebug()/getDebugFile() を参照

import { createWriteStream, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import os from "node:os";

let enabled = false;
let filePath: string | null = null;
let sinkInstalled = false;

export function isDebug(): boolean {
  return enabled;
}

export function getDebugFile(): string | null {
  return filePath;
}

export function setDebug(on: boolean, file: string | null = null): void {
  enabled = !!on;
  filePath = file || null;
  if (!enabled) return;
  if (filePath) installFileSink(filePath);
}

function installFileSink(path: string): void {
  if (sinkInstalled) return;
  try {
    let p = path;
    if (p.startsWith("~")) p = os.homedir() + p.slice(1);
    const resolvedPath = resolve(p);
    try { mkdirSync(dirname(resolvedPath), { recursive: true }); } catch {}
    const stream = createWriteStream(resolvedPath, { flags: "a", encoding: "utf8" });
    const origWrite = process.stderr.write.bind(process.stderr) as typeof process.stderr.write;
    process.stderr.write = ((chunk: any, encoding?: any, cb?: any) => {
      try { stream.write(chunk as any); } catch {}
      return origWrite(chunk as any, encoding as any, cb as any);
    }) as any;
    process.on("exit", () => { try { stream.end(); } catch {} });
    sinkInstalled = true;
  } catch {
    // ファイルシンクに失敗しても画面出力のみ継続
  }
}
