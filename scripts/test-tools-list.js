#!/usr/bin/env node
// テスト目的: tools/list に `answer`/`answer_detailed`/`answer_quick` の3ツールが含まれることを検証。
// OpenAI API 呼び出しは発生しない。成功で exit 0、失敗で exit 1。

import { spawn } from 'node:child_process';

function enc(obj){ const s=JSON.stringify(obj); return `Content-Length: ${Buffer.byteLength(s,'utf8')}\r\n\r\n${s}`; }

const child = spawn('node', ['build/index.js','--stdio'], {
  stdio: 'pipe'
});

let out = '';
child.stdout.on('data', (b) => { out += b.toString('utf8'); });
child.stderr.on('data', (b) => process.stderr.write(b));

// initialize
child.stdin.write(enc({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', capabilities:{} } }));
// tools/list
setTimeout(() => {
  child.stdin.write(enc({ jsonrpc:'2.0', id:2, method:'tools/list', params:{} }));
}, 60);

setTimeout(() => {
  try { child.kill(); } catch {}
  const hasAnswer = out.includes('"name":"answer"');
  const hasDetailed = out.includes('"name":"answer_detailed"');
  const hasQuick = out.includes('"name":"answer_quick"');
  const ok = hasAnswer && hasDetailed && hasQuick;
  if (!ok) {
    console.error('[test] tools-list: FAILED');
    if (!hasAnswer) console.error(' - missing: answer');
    if (!hasDetailed) console.error(' - missing: answer_detailed');
    if (!hasQuick) console.error(' - missing: answer_quick');
  }
  process.exit(ok ? 0 : 1);
}, 1200);
