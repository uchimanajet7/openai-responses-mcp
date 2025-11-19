#!/usr/bin/env node
import { spawn } from "node:child_process";

function encode(msg) {
  const json = JSON.stringify(msg);
  return `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`;
}

const child = spawn("node", ["build/index.js", "--stdio"], { stdio: "pipe" });

child.stdout.on("data", (buf) => process.stdout.write(buf));
child.stderr.on("data", (buf) => process.stderr.write(buf));

child.stdin.write(encode({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {} } }));
setTimeout(() => {
  child.stdin.write(encode({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
}, 80);
setTimeout(() => {
  child.stdin.write(encode({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "answer", arguments: { query: "hello" } } }));
}, 160);
// answer の検索完了を待つため 4s 以上確保（docs/spec.md §10）
setTimeout(() => child.kill(), 4000);
