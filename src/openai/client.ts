import OpenAI from "openai";
import type { ResponseIncludable } from "openai/resources/responses/responses";
import { isDebug } from "../debug/state.js";
import { Config } from "../config/defaults.js";

export function createClient(cfg: Config) {
  const apiKey = process.env[cfg.openai.api_key_env];
  if (!apiKey) {
    throw new Error(`Missing API key: set ${cfg.openai.api_key_env}`);
  }
  const client = new OpenAI({
    apiKey,
    baseURL: cfg.openai.base_url
  });
  return client;
}

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

export type CallArgs = {
  model: string;
  instructions?: string;
  input: any;
  tools?: any[];
  include?: ResponseIncludable[] | null;
  // Responses API。モデル対応時のみ付与される想定。
  text?: any;
  reasoning?: any;
};

export async function callResponsesWithRetry(
  client: OpenAI,
  cfg: Config,
  args: CallArgs,
  externalSignal?: AbortSignal
) {
  const timeoutMs = cfg.request.timeout_ms;
  const maxRetries = cfg.request.max_retries;
  let lastError: any;

  // model_profiles構造に基づくリトライ。フォールバック機能は削除済み。
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 事前にキャンセル済みなら即中断
      if (externalSignal?.aborted) {
        const err = new Error("Aborted before request");
        (err as any).name = "AbortError";
        throw err;
      }

      const controller = new AbortController();
      const onAbort = () => controller.abort();
      if (externalSignal) externalSignal.addEventListener('abort', onAbort);
      const to = setTimeout(() => controller.abort(), timeoutMs);
      const resp = await client.responses.create(args, { signal: controller.signal } as any);
      clearTimeout(to);
      if (externalSignal) externalSignal.removeEventListener('abort', onAbort);
      return { response: resp, model: args.model };
    } catch (e: any) {
      lastError = e;
      // 単一判定に基づくデバッグ出力
      if (isDebug()) {
        try {
          const status = (e && (e.status ?? e.code)) ?? '-';
          const ename = e?.name ?? '-';
          const etype = e?.error?.type ?? '-';
          const emsg = (e?.message ?? String(e)).slice(0, 400);
          // OpenAI SDK APIError 互換で body を持つ場合、先頭のみ抜粋
          const bodyRaw: any = (e?.error ?? e?.response?.data ?? e?.response?.body ?? undefined);
          let bodyExcerpt = '';
          if (typeof bodyRaw === 'string') bodyExcerpt = bodyRaw.slice(0, 300);
          else if (bodyRaw && typeof bodyRaw === 'object') bodyExcerpt = JSON.stringify(bodyRaw).slice(0, 300);
          console.error(`[openai] error attempt=${attempt} status=${status} type=${etype} name=${ename} msg="${emsg}" body="${bodyExcerpt}"`);
        } catch {}
      }
      const aborted = externalSignal?.aborted || e?.name === "AbortError" || e?.name === "APIUserAbortError";
      // キャンセル時は即中断。リトライしない。
      if (aborted) break;
      const retriable = (e?.status && (e.status === 429 || e.status >= 500));
      if (!retriable || attempt === maxRetries) break;
      const backoff = 300 * Math.pow(2, attempt);
      await delay(backoff);
    }
  }
  throw lastError;
}
