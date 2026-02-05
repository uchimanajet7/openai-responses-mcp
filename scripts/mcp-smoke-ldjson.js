#!/usr/bin/env node
// 行区切りJSONでの最小疎通スモーク。Content-Lengthなし。
// initialize → tools/list を送信し、サーバの応答をそのまま標準出力に流す
import { spawn } from "node:child_process";

const child = spawn("node", ["build/index.js", "--stdio"], { stdio: "pipe" });

child.stdout.on("data", (buf) => process.stdout.write(buf));
child.stderr.on("data", (buf) => process.stderr.write(buf));

function j(x) { return JSON.stringify(x); }

const init = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: { roots: {} },
    clientInfo: { name: "smoke-ldjson", version: "0" }
  }
};
const list = { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} };

// 行区切りJSONで送信する。Content-Lengthを付けない。
child.stdin.write(j(init) + "\n", "utf8");
setTimeout(() => child.stdin.write(j(list) + "\n", "utf8"), 100);

// 短時間で kill して終了する。
setTimeout(() => { try { child.kill(); } catch {} }, 1500);
