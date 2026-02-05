import { stdin, stdout } from "node:process";
import { isDebug } from "../debug/state.js";

export type JsonRpcMessage = { [k: string]: any };

let lineDelimitedMode = false; // Claude互換: 行区切りJSONでやり取りする場合に有効化
export function enableLineDelimitedMode() { lineDelimitedMode = true; }

export function writeMessage(msg: JsonRpcMessage): void {
  const json = JSON.stringify(msg);
  const debug = isDebug();
  if (lineDelimitedMode || process.env.MCP_LINE_MODE === "1") {
    if (debug) {
      try {
        console.error(`[mcp] send (line) bytes=${Buffer.byteLength(json, "utf8")}`);
        console.error(`[mcp] send json=${json}`);
      } catch {}
    }
    stdout.write(json + "\n", "utf8");
  } else {
    const header = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n`;
    if (debug) {
      try {
        console.error(`[mcp] send (framed) bytes=${Buffer.byteLength(json, "utf8")}`);
        console.error(`[mcp] send json=${json}`);
      } catch {}
    }
    stdout.write(header, "utf8");
    stdout.write(json, "utf8");
  }
}

export function readMessages(onMessage: (msg: JsonRpcMessage) => void): void {
  let buffer = Buffer.alloc(0);
  let seqCounter = 0; // デバッグ用の段階トレースID
  try {
    // 一部環境で安全のため明示的にresume
    stdin.resume();
  } catch {}

  stdin.on("data", (chunk) => {
    const chunkBuf = typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk;
    if (isDebug()) {
      try {
        const preview = chunkBuf.toString("utf8").replace(/\r/g, "<CR>").replace(/\n/g, "<LF>");
        console.error(`[mcp] stdin chunk=${chunkBuf.length} preview="${preview.slice(0, 200)}"`);
      } catch {}
    }
    buffer = Buffer.concat([buffer, chunkBuf]);
    while (true) {
      // ヘッダ終端を検出する。CRLFCRLF を優先し、無ければ LFLF を許容する。
      let headerEnd = buffer.indexOf("\r\n\r\n");
      let sepLen = 4;
      if (headerEnd === -1) {
        const alt = buffer.indexOf("\n\n");
        if (alt !== -1) { headerEnd = alt; sepLen = 2; }
      }
      if (headerEnd === -1) {
        // フレーミングヘッダが無い場合、LF区切りのプレーンJSONを許容するフォールバック
        const lf = buffer.indexOf("\n");
        if (lf !== -1) {
          const line = buffer.slice(0, lf).toString("utf8").trim();
          if (line.length > 0) {
        try {
          const msg = JSON.parse(line);
          if (isDebug()) {
            console.error(`[mcp] fallback parse line bytes=${Buffer.byteLength(line, "utf8")}`);
          }
          buffer = buffer.slice(lf + 1);
          // 以後の応答は行区切りで返す。互換性のため。
          enableLineDelimitedMode();
          onMessage(msg);
          continue; // 次のメッセージへ
        } catch {
              // 行単位JSONでなければ、次のデータを待つ
            }
          }
        }
        break;
      }
      const headerBuf = buffer.slice(0, headerEnd);
      const header = headerBuf.toString("utf8");
      if (isDebug()) {
        try {
          const preview = header.replace(/\r/g, "<CR>").replace(/\n/g, "<LF>");
          console.error(`[mcp] headerEnd=${headerEnd} sepLen=${sepLen} header="${preview}"`);
        } catch {}
      }
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        if (isDebug()) {
          console.error(`[mcp] Content-Length not found in header`);
        }
        buffer = buffer.slice(headerEnd + sepLen);
        continue;
      }
      const len = parseInt(match[1], 10);
      const seq = ++seqCounter;
      if (isDebug()) {
        console.error(`[mcp][#${seq}] header ok content-length=${len}`);
      }
      const bodyStart = headerEnd + sepLen;
      const bodyEnd = bodyStart + len;
      if (buffer.length < bodyEnd) {
        if (isDebug()) {
          console.error(`[mcp][#${seq}] wait body need=${len} have=${buffer.length - bodyStart}`);
        }
        break;
      }
      const json = buffer.slice(bodyStart, bodyEnd).toString("utf8");
      if (isDebug()) {
        try { console.error(`[mcp][#${seq}] recv bytes=${len}`); } catch {}
      }
      buffer = buffer.slice(bodyEnd);
      try {
        const msg = JSON.parse(json);
        if (isDebug()) {
          const m = (msg as any)?.method;
          console.error(`[mcp][#${seq}] parsed ok method=${m ?? "<n/a>"}`);
        }
        onMessage(msg);
      } catch (e) {
        if (isDebug()) {
          console.error(`[mcp][#${seq}] JSON parse error`, (e as any)?.message || String(e));
        }
      }
    }
  });
}
