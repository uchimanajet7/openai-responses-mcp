#!/usr/bin/env node
// 簡易スモーク（要 OPENAI_API_KEY）: answer_quick（既定）/ answer / answer_detailed を叩き、エラー時の error.data を可視化
// 使い方:
//   node scripts/mcp-smoke-apikey.js "今日の東京の気温"
//   node scripts/mcp-smoke-apikey.js --tool answer "今日の東京の気温"
//   node scripts/mcp-smoke-apikey.js --tool answer_detailed "今日の東京の気温"

import { spawn } from "node:child_process";

function parseArgs(argv) {
  const out = { tool: "answer_quick", query: "" };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--tool" && typeof argv[i + 1] === "string") {
      out.tool = argv[i + 1];
      i++;
      continue;
    }
    if (a.startsWith("--tool=")) {
      out.tool = a.slice("--tool=".length);
      continue;
    }
    rest.push(a);
  }
  out.query = rest.join(" ");
  return out;
}

const { tool, query: queryRaw } = parseArgs(process.argv.slice(2));
const allowedTools = new Set(["answer", "answer_detailed", "answer_quick"]);
if (!allowedTools.has(tool)) {
  console.error(`[mcp:smoke-apikey] invalid --tool "${tool}". allowed: answer | answer_detailed | answer_quick`);
  process.exit(2);
}
const query = queryRaw || "今日の東京の気温";
const toolsCallId = 3;
// web_search が走ると 4s を超えることがあるため、応答待ちの上限を広げる
const hardTimeoutMs = 30_000;

function encode(msg) {
  const json = JSON.stringify(msg);
  return `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
}

function start() {
  const child = spawn("node", ["build/index.js", "--stdio"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, DEBUG: "1" } // DEBUG 有効化
  });

  let done = false;
  const hardTimeout = setTimeout(() => {
    if (done) return;
    done = true;
    console.error(`[mcp:smoke-apikey] timeout: tools/call(name=${tool} id=${toolsCallId}) の応答待ちが ${hardTimeoutMs}ms を超えました`);
    try { child.kill(); } catch {}
  }, hardTimeoutMs);

  function finish() {
    if (done) return;
    done = true;
    clearTimeout(hardTimeout);
    // web_search が走ると遅延出力が発生しうるため、DoD（docs/spec.md）に合わせて 4s 以上待ってから終了
    setTimeout(() => { try { child.kill(); } catch {} }, 4000);
  }

  let buf = Buffer.alloc(0);
  child.stdout.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    // Content-Length フレーミングの単純パーサ
    while (true) {
      const headerEnd = buf.indexOf(Buffer.from("\r\n\r\n"));
      if (headerEnd === -1) break;
      const header = buf.slice(0, headerEnd).toString("utf8");
      const m = header.match(/Content-Length:\s*(\d+)/i);
      if (!m) { console.log("<no content-length header>\n" + header); return; }
      const len = parseInt(m[1], 10);
      const start = headerEnd + 4;
      if (buf.length < start + len) break; // まだ足りない
      const body = buf.slice(start, start + len).toString("utf8");
      buf = buf.slice(start + len);
      try {
        const msg = JSON.parse(body);
        if (msg?.error) {
          console.log("[tools/call error]\n" + JSON.stringify(msg.error, null, 2));
        } else if (msg?.result) {
          console.log("[tools/call result]\n" + JSON.stringify(msg.result, null, 2));
        } else {
          // initialize / tools/list など
          console.log("[message]\n" + JSON.stringify(msg, null, 2));
        }

        if (msg?.id === toolsCallId && (msg?.result || msg?.error)) {
          finish();
        }
      } catch (e) {
        console.error("[parse error]", e.message);
      }
    }
  });

  child.stderr.on("data", (buf) => process.stderr.write(buf));

  // initialize → tools/list → tools/call(<tool>)
  child.stdin.write(encode({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } }));
  setTimeout(() => {
    child.stdin.write(encode({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
  }, 80);
  setTimeout(() => {
    child.stdin.write(encode({ jsonrpc: "2.0", id: toolsCallId, method: "tools/call", params: { name: tool, arguments: { query } } }));
  }, 160);
}

start();
