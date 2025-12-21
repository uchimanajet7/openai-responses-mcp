import type { Config } from "../config/defaults.js";
import { createClient, callResponsesWithRetry } from "../openai/client.js";
import { SYSTEM_POLICY } from "../policy/system-policy.js";
import { isDebug } from "../debug/state.js";
import { resolveSystemPolicy } from "../policy/resolve.js";

export type AnswerInput = {
  query: string;
  recency_days?: number;
  max_results?: number;
  domains?: string[];
  style?: "summary" | "bullets" | "citations-only";
};

type Citation = { url: string; title?: string; published_at?: string | null };
type AnswerOut = {
  answer: string;
  used_search: boolean;
  citations: Citation[];
  model: string;
};

function isoDateJst(now: Date = new Date()): string {
  // JST は固定オフセット（+09:00、サマータイムなし）
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

function toIsoDateMaybe(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

function pickUrlCitationFields(annotation: any): { url?: string; title?: string } {
  if (!annotation) return {};
  // Responses API の例（フラット）
  if (typeof annotation.url === "string") {
    const title = typeof annotation.title === "string" ? annotation.title : undefined;
    return { url: annotation.url, title };
  }
  // Chat 互換（ネスト）: { type:"url_citation", url_citation:{ url, title, ... } }
  const nested = annotation.url_citation;
  if (nested && typeof nested.url === "string") {
    const title = typeof nested.title === "string" ? nested.title : undefined;
    return { url: nested.url, title };
  }
  return {};
}

function extractUrlsFromText(text: string, limit = 50): string[] {
  const out: string[] = [];
  const re = /https?:\/\/[^\s"'<>]+/g;
  for (const m of text.matchAll(re)) {
    if (out.length >= limit) break;
    const raw = m[0];
    const cleaned = raw.replace(/[),.;]+$/, "");
    out.push(cleaned);
  }
  return out;
}

function extractUrlsDeep(root: unknown, maxDepth = 8, maxUrls = 50): string[] {
  const urls = new Set<string>();
  const seen = new Set<any>();
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  while (stack.length && urls.size < maxUrls) {
    const cur = stack.pop()!;
    const value = cur.value;
    const depth = cur.depth;
    if (typeof value === "string") {
      for (const u of extractUrlsFromText(value, maxUrls - urls.size)) urls.add(u);
      continue;
    }
    if (!value || typeof value !== "object") continue;
    if (seen.has(value)) continue;
    seen.add(value);
    if (depth >= maxDepth) continue;
    if (Array.isArray(value)) {
      for (const v of value) stack.push({ value: v, depth: depth + 1 });
    } else {
      for (const v of Object.values(value as any)) stack.push({ value: v, depth: depth + 1 });
    }
  }
  return [...urls];
}

function extractWebSearchSources(webSearchCall: any): Citation[] {
  const out: Citation[] = [];
  const sources =
    webSearchCall?.action?.sources ??
    webSearchCall?.web_search_call?.action?.sources ??
    webSearchCall?.sources ??
    null;
  if (!Array.isArray(sources)) {
    // 仕様/SDK の差分や将来変更に備え、web_search_call 内の URL らしき文字列を総当たりで回収する
    const urls = extractUrlsDeep(webSearchCall);
    for (const url of urls) out.push({ url, published_at: null });
    return out;
  }
  for (const s of sources) {
    if (typeof s === "string") {
      out.push({ url: s, published_at: null });
      continue;
    }
    if (!s || typeof s !== "object") continue;
    const url =
      typeof (s as any).url === "string"
        ? (s as any).url
        : typeof (s as any).link === "string"
          ? (s as any).link
          : undefined;
    const title =
      typeof (s as any).title === "string"
        ? (s as any).title
        : typeof (s as any).name === "string"
          ? (s as any).name
          : undefined;
    const publishedAt =
      toIsoDateMaybe((s as any).published_at) ??
      toIsoDateMaybe((s as any).published_date) ??
      toIsoDateMaybe((s as any).date) ??
      null;
    if (url) {
      out.push({ url, title, published_at: publishedAt });
      continue;
    }
    // URL が無い sources 要素（例: {type:"api", name:"oai-weather"}）は、情報源IDとして採用する
    const name = typeof (s as any).name === "string" ? (s as any).name : undefined;
    if (!name) continue;
    const kind = typeof (s as any).type === "string" ? (s as any).type : undefined;
    out.push({ url: name, title: kind || undefined, published_at: publishedAt });
  }
  return out;
}

function hasSourcesSection(text: string): boolean {
  return /(^|\n)Sources:\s*/.test(text);
}

function sourcesSectionHasIsoDate(text: string): boolean {
  const idx = text.lastIndexOf("Sources:");
  if (idx < 0) return false;
  return /\d{4}-\d{2}-\d{2}/.test(text.slice(idx));
}

function formatSources(citations: Citation[]): string {
  const lines: string[] = [];
  for (const c of citations) {
    const date = c.published_at ?? null;
    lines.push(`- ${c.url}${date ? ` (${date})` : ""}`);
  }
  return lines.join("\n");
}

function toHints(inp: AnswerInput, cfg: Config): string {
  const r = inp.recency_days ?? cfg.search.defaults.recency_days;
  const m = inp.max_results ?? cfg.search.defaults.max_results;
  const d = inp.domains && inp.domains.length ? ` domains: ${inp.domains.join(", ")}` : "";
  return `\n[Hints] recency_days=${r}, max_results=${m}.${d}`;
}

function extractOutputText(resp: any): string {
  if (resp.output_text) return resp.output_text;
  try {
    const parts = [];
    for (const o of resp.output || []) {
      if (o?.content) {
        for (const c of o.content) {
          if (c?.type === "output_text" && typeof c.text === "string") parts.push(c.text);
        }
      }
    }
    return parts.join("\n\n");
  } catch {
    return "";
  }
}

function extractCitations(resp: any): { citations: Citation[]; used: boolean } {
  const set = new Map<string, Citation>();
  let used = false;
  const fallbackFromSources: Citation[] = [];
  let urlCitationCount = 0;
  let sourcesCount = 0;
  const accessDate = isoDateJst();
  try {
    for (const o of resp.output || []) {
      if (o?.type === "web_search_call") {
        used = true;
        const sources = extractWebSearchSources(o);
        sourcesCount += sources.length;
        fallbackFromSources.push(...sources);
      }
      if (o?.content) {
        for (const c of o.content) {
          const anns = c?.annotations || [];
          for (const an of anns) {
            if (an?.type === "url_citation") {
              const { url, title } = pickUrlCitationFields(an);
              if (!url) continue;
              urlCitationCount += 1;
              used = true;
              const key = url;
              if (!set.has(key)) set.set(key, { url, title: title || undefined, published_at: accessDate });
            }
          }
        }
      }
    }
  } catch {}
  // `url_citation` を優先しつつ、`web_search_call.action.sources` 由来の情報源も必要に応じて併記する。
  // - `url_citation` が 0 件の場合: sources 由来（URL/情報源ID）を採用して `citations[]` を空にしない
  // - `url_citation` がある場合: URL 以外の情報源ID（例: oai-weather 等）を併記して「どこから検索したか」を落とさない
  if (fallbackFromSources.length) {
    const includeAll = set.size === 0;
    for (const c of fallbackFromSources) {
      const url = c?.url;
      if (!url) continue;
      const isHttpUrl = /^https?:\/\//i.test(url);
      if (!includeAll && isHttpUrl) continue;
      if (!set.has(url)) {
        const publishedAt = toIsoDateMaybe(c.published_at) ?? accessDate;
        set.set(url, { url, title: c.title || undefined, published_at: publishedAt });
      }
    }
  }
  // 日付は ISO（YYYY-MM-DD）。公開日が取れない場合はアクセス日を埋める。
  const citations = [...set.values()].map((c) => ({
    url: c.url,
    title: c.title || undefined,
    published_at: toIsoDateMaybe(c.published_at) ?? accessDate
  }));
  if (isDebug()) {
    try {
      console.error(
        `[answer] response parsed used_search=${used} url_citations=${urlCitationCount} sources=${sourcesCount} citations_out=${citations.length}`
      );
    } catch {}
  }
  return { citations, used };
}

// `signal` は MCP キャンセルを伝搬するために使用
export async function callAnswer(input: AnswerInput, cfg: Config, profileName?: string, signal?: AbortSignal) {
  const client = createClient(cfg);
  // SSOT（src/policy/system-policy.ts）を既定とし、必要に応じて外部policy.mdを合成
  const system = resolveSystemPolicy(cfg);
  const userText = `${input.query}${toHints(input, cfg)}`;

  // プロファイル設定を取得（指定がない場合はanswerproveイル使用）
  const effectiveProfileName = profileName || 'answer';
  const profile = cfg.model_profiles[effectiveProfileName as keyof typeof cfg.model_profiles] || cfg.model_profiles.answer;
  
  if (!profile) {
    throw new Error(`model_profiles.${effectiveProfileName} is required`);
  }

  // モデル互換性チェック
  const supportsVerbosity = profile.model.startsWith('gpt-5');
  const supportsReasoningEffort = profile.model.startsWith('gpt-5') ||
                                  profile.model.startsWith('o3') ||
                                  profile.model.startsWith('o4');

  const requestBody: any = {
    model: profile.model,
    instructions: system,
    input: [{ role: "user", content: [{ type: "input_text", text: userText }]}],
    tools: [{ type: "web_search" }],
    // web_search の参照URL一覧を取得（`url_citation` が返らない場合のフォールバック用）
    include: ["web_search_call.action.sources"]
  };

  // プロファイル設定を適用（モデル対応時のみ）
  if (supportsVerbosity) {
    requestBody.text = { verbosity: profile.verbosity };
  }
  if (supportsReasoningEffort) {
    const effort = profile.reasoning_effort;
    requestBody.reasoning = { effort };
  }

  // DEBUG ログ: プロファイル・対応機能・送信要約（単一判定）
  if (isDebug()) {
    try {
      const toolsOn = Array.isArray(requestBody.tools) && requestBody.tools.some((t: any) => t?.type === 'web_search');
      const reasoningOn = !!requestBody.reasoning;
      const textVerbOn = !!requestBody.text?.verbosity;
      console.error(`[answer] profile=${effectiveProfileName} model=${profile.model} supports={verbosity:${supportsVerbosity}, reasoning:${supportsReasoningEffort}}`);
      console.error(`[answer] request summary tools=web_search(${toolsOn ? 'on':'off'}) reasoning=${reasoningOn ? 'on':'off'} text.verbosity=${textVerbOn ? 'on':'off'}`);
    } catch {}
  }

  const { response, model } = await callResponsesWithRetry(client, cfg, requestBody, signal);

  let answer = extractOutputText(response);
  const { citations, used } = extractCitations(response);
  const limitedCitations = citations.slice(0, cfg.policy.max_citations);
  // `used_search=true` のとき、本文末尾に Sources が無い場合はサーバ側で補完する
  if (used && limitedCitations.length) {
    const hasSources = hasSourcesSection(answer);
    const hasIsoDate = sourcesSectionHasIsoDate(answer);
    if (!hasSources) {
      answer = `${answer.trimEnd()}\n\nSources:\n${formatSources(limitedCitations)}`;
    } else if (!hasIsoDate) {
      // 既存の Sources が日付を欠いている場合の救済（ヘッダは重複させない）
      answer = `${answer.trimEnd()}\n${formatSources(limitedCitations)}`;
    }
  }

  return {
    answer,
    used_search: used,
    citations: limitedCitations,
    model
  };
}

export const answerToolDef = {
  name: "answer",
  description: "必要に応じてWeb検索を実行し、根拠（出典付き）で回答を返す",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string" },
      recency_days: { type: "number" },
      max_results: { type: "number" },
      domains: { type: "array", items: { type: "string" } },
      style: { enum: ["summary","bullets","citations-only"] }
    },
    required: ["query"]
  }
};
