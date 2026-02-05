#!/usr/bin/env node
// テスト目的: tools/call 実行直後に notifications/cancelled を送り、
// 当該 id の result/error が出力されないことを確認するスモーク。応答は抑止される。
// OPENAI_API_KEY が未設定の場合はスキップする。exit 0。

import { spawn } from 'node:child_process';

if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.trim() === '') {
  console.error('[test] SKIP: OPENAI_API_KEY is not set');
  process.exit(0);
}

function enc(obj){ const s=JSON.stringify(obj); return `Content-Length: ${Buffer.byteLength(s,'utf8')}\r\n\r\n${s}`; }

const child = spawn('node', ['build/index.js','--stdio'], {
  stdio: 'pipe',
  env: { ...process.env, DEBUG: '1' }
});

let sawCallResponse = false;

child.stdout.on('data', b => {
  const t = b.toString('utf8');
  process.stdout.write(b);
  // 応答抑止の確認: id:3 の result/error が出たら検出
  if (/"id"\s*:\s*3/.test(t) && (/"result"|"error"/.test(t))) {
    sawCallResponse = true;
    console.error('[test] UNEXPECTED: received response for id=3 after cancel');
  }
});

child.stderr.on('data', b => process.stderr.write(b));

// 1) initialize
child.stdin.write(enc({ jsonrpc:'2.0', id:1, method:'initialize', params:{ protocolVersion:'2025-06-18', capabilities:{} } }));

// 2) tools/call (id=3)
setTimeout(() => {
  const args = { name:'answer', arguments:{ query:'最新の大規模言語モデルの比較と評価手法を包括的に要約してください。参考文献と日付を含めてください。' } };
  child.stdin.write(enc({ jsonrpc:'2.0', id:3, method:'tools/call', params: args }));
  // 直後にキャンセル通知
  setTimeout(() => {
    child.stdin.write(enc({ jsonrpc:'2.0', method:'notifications/cancelled', params:{ requestId: 3, reason:'user-request' } }));
  }, 40);
}, 80);

// 3) 観測用の時間をおいて終了する。抑止されていれば id:3 の応答は出ない。
setTimeout(() => {
  try { child.kill(); } catch {}
  const ok = !sawCallResponse;
  if (ok) console.error('[test] OK: no response for id=3 after cancel');
  process.exit(ok ? 0 : 1);
}, 15000);
