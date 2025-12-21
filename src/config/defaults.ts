export type Transport = "stdio";

export interface ModelProfile {
  model: string;
  // OpenAI API（reasoning.effort）: low | medium | high | xhigh（Extra high）
  reasoning_effort: "low" | "medium" | "high" | "xhigh";
  verbosity: "low" | "medium" | "high";
}

export interface Config {
  openai: {
    api_key_env: string;
    base_url: string;
  };
  model_profiles: {
    answer: ModelProfile;
    answer_detailed?: ModelProfile;
    answer_quick?: ModelProfile;
  };
  request: { timeout_ms: number; max_retries: number };
  policy: {
    prefer_search_when_unsure: boolean;
    max_citations: number;
    require_dates_iso: boolean;
    system?: {
      source: "builtin" | "file"; // 外部policy.mdの読込制御（YAMLのみで指定）
      path?: string;               // policy.md のパス（~ 展開可）
      merge?: "replace" | "prepend" | "append"; // 内蔵SSOTとの合成方法
    };
  };
  search: { defaults: { recency_days: number; max_results: number; domains: string[] } };
  server: { transport: Transport; debug: boolean; debug_file: string | null; show_config_on_start: boolean };
}

export const defaults: Config = {
  openai: {
    api_key_env: "OPENAI_API_KEY",
    base_url: "https://api.openai.com/v1"
  },
  model_profiles: {
    answer: {
      model: "gpt-5.2",
      reasoning_effort: "medium",
      verbosity: "medium"
    }
  },
  request: { timeout_ms: 300_000, max_retries: 3 },
  policy: {
    prefer_search_when_unsure: true,
    max_citations: 3,
    require_dates_iso: true,
    system: { source: "builtin", merge: "replace" }
  },
  search: { defaults: { recency_days: 60, max_results: 5, domains: [] } },
  server: { transport: "stdio", debug: false, debug_file: null, show_config_on_start: false }
};
