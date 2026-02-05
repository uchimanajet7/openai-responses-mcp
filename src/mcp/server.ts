import { readMessages, writeMessage } from "./protocol.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { callAnswer } from "../tools/answer.js";
import { TOOL_DEFINITIONS } from "../tools/tool-definitions.js";
import type { Config } from "../config/defaults.js";
import { isDebug } from "../debug/state.js";

type JsonRpc = {
  jsonrpc?: "2.0";
  id?: number | string;
  method?: string;
  params?: any;
  result?: any;
  error?: any;
};

const PROTOCOL = "2025-06-18";
const __dirname = dirname(fileURLToPath(import.meta.url));
function ts(): string { return new Date().toISOString(); }
function logInfo(msg: string): void { console.error(`[mcp] ${ts()} INFO ${msg}`); }
function logError(msg: string): void { console.error(`[mcp] ${ts()} ERROR ${msg}`); }
function pkgVersion(): string {
  try {
    const pkgPath = join(__dirname, "..", "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
    return String(pkg.version || "0.0.0");
  } catch {
    return "0.0.0";
  }
}
// デバッグ判定は共通の isDebug() に統一

function sendResult(id: number | string, result: any) {
  writeMessage({ jsonrpc: "2.0", id, result });
}
function sendError(id: number | string, code: number, message: string, data?: any) {
  writeMessage({ jsonrpc: "2.0", id, error: { code, message, data } });
}

export function startServer(cfg: Config) {
  if (isDebug()) logInfo(`server.start pid=${process.pid}`);
  // 進行中リクエスト: id -> { controller, cancelled }
  const inflight = new Map<number | string, { controller: AbortController; cancelled: boolean }>();
  // 起動時要約。stderr に出し、MCP の stdout は汚さない。
  try {
    const srv: any = (cfg as any).server || {};
    const mp: any = (cfg as any).model_profiles?.answer || {};
    const rq: any = (cfg as any).request || {};
    const sh = !!srv.show_config_on_start;
    if (isDebug() || sh) {
      logInfo(`config summary: model(answer)=${mp.model ?? '-'} effort=${mp.reasoning_effort ?? '-'} verbosity=${mp.verbosity ?? '-'} timeout_ms=${rq.timeout_ms ?? '-'} retries=${rq.max_retries ?? '-'}`);
      const pol: any = (cfg as any).policy?.system || {};
      if (pol?.source === 'file') logInfo(`policy: source=file path=${pol.path ?? ''} merge=${pol.merge ?? 'replace'}`);
    }
  } catch {}
  readMessages(async (raw: any) => {
    const msg = raw as JsonRpc;
    if (isDebug()) {
      const method = msg?.method || (msg?.result ? "<result>" : msg?.error ? "<error>" : "<unknown>");
      logInfo(`recv method=${method} id=${String(msg?.id ?? "-")}`);
    }

    if (msg.method === "initialize" && msg.id !== undefined) {
      const res = {
        protocolVersion: PROTOCOL,
        // 本サーバは roots を未実装のため広告しない。tools のみ。
        capabilities: { tools: {} },
        serverInfo: { name: "openai-responses-mcp", version: pkgVersion() }
      };
      if (isDebug()) logInfo(`initialize -> ok`);
      sendResult(msg.id, res);
      return;
    }

    if (msg.method === "tools/list" && msg.id !== undefined) {
      const tools = Object.values(TOOL_DEFINITIONS);
      if (isDebug()) logInfo(`tools/list -> ${tools.length} tools`);
      sendResult(msg.id, { tools });
      return;
    }

    if (msg.method === "tools/call" && msg.id !== undefined) {
      const { name, arguments: args } = (msg.params || {}) as { name?: string; arguments?: any };
      if (isDebug()) {
        try {
          const keys = Object.keys(args || {});
          const qlen = typeof (args?.query) === 'string' ? (args.query as string).length : undefined;
          logInfo(`tools/call name=${name} argsKeys=[${keys.join(',')}] queryLen=${qlen ?? '-'}`);
        } catch {}
      }
      // プロファイル名として直接使用
      if (name && name in TOOL_DEFINITIONS) {
        try {
          // リクエスト毎の AbortController を準備する。キャンセル通知で中断する。
          const entry = { controller: new AbortController(), cancelled: false };
          inflight.set(msg.id, entry);
          const out = await callAnswer(args, cfg, name, entry.controller.signal);  // プロファイル名 + キャンセル伝搬
          // キャンセルされていれば応答抑止
          const cur = inflight.get(msg.id) || entry;
          const abortedNow = cur.cancelled || cur.controller.signal.aborted;
          if (abortedNow) {
            if (isDebug()) logInfo(`tools/call(${name}) cancelled -> suppress response`);
            inflight.delete(msg.id);
            return;
          }
          if (isDebug()) logInfo(`tools/call(${name}) -> ok`);
          sendResult(msg.id, { content: [{ type: "text", text: JSON.stringify(out) }] });
          inflight.delete(msg.id);
        } catch (e: any) {
          const dbg = isDebug();
          let status: any = '-';
          let etype: any = '-';
          let ename: any = '-';
          let emsg: string = e?.message || String(e);
          // キャンセル後のエラーは握りつぶす。応答しない。
          const cur = inflight.get(msg.id);
          const aborted = cur?.cancelled || cur?.controller?.signal?.aborted;
          if (aborted) {
            if (dbg) {
              try { logInfo(`tools/call(${name}) aborted -> suppress error response`); } catch {}
            }
            inflight.delete(msg.id);
            return;
          }
          if (dbg) {
            try {
              status = (e && (e.status ?? e.code)) ?? '-';
              ename = e?.name ?? '-';
              etype = e?.error?.type ?? '-';
              emsg = (e?.message ?? String(e)).slice(0, 400);
              logError(`tools/call(${name}) -> error status=${status} type=${etype} name=${ename} msg="${emsg}"`);
            } catch {}
          }
          const data = dbg
            ? { message: emsg, status, type: etype, name: ename }
            : { message: e?.message || String(e) };
          sendError(msg.id, -32001, "answer failed", data);
        }
      } else {
        if (isDebug()) logError(`unknown tool: ${name}`);
        sendError(msg.id, -32601, "Unknown tool");
      }
      return;
    }

    // キャンセル通知。通知なので応答不要。
    if (msg.method === "notifications/cancelled") {
      try {
        const rid = (msg?.params as any)?.requestId;
        const reason = (msg?.params as any)?.reason;
        if (rid !== undefined && inflight.has(rid)) {
          const e = inflight.get(rid)!;
          e.cancelled = true;
          try { e.controller.abort(); } catch {}
          if (isDebug()) logInfo(`cancelled requestId=${String(rid)} reason=${reason ?? '-'} -> abort signaled`);
        } else {
          if (isDebug()) logInfo(`cancelled requestId=${String(rid)} (no inflight)`);
        }
      } catch {}
      return;
    }

    // ping 最小実装。ヘルスチェック用途。
    if (msg.method === "ping") {
      if (isDebug()) logInfo(`recv method=ping id=${String(msg?.id ?? '-')}`);
      if (msg.id !== undefined) {
        // 空オブジェクトでOK。仕様上は実装依存。
        sendResult(msg.id, {});
      }
      return;
    }

    if (msg.id !== undefined) {
      if (isDebug()) logError(`unknown method: ${msg.method}`);
      sendError(msg.id, -32601, "Unknown method");
    }
  });
}
