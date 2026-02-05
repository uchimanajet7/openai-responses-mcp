export interface ModelProfile {
  model: string;
  // OpenAI API の reasoning.effort は low | medium | high | xhigh。xhigh は extra high。
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
    max_citations: number;
    system?: {
      source: "builtin" | "file"; // 外部 policy.md の読込制御。YAML でのみ指定する。
      path?: string;               // policy.md のパス。~ を展開する。
      merge?: "replace" | "prepend" | "append"; // 内蔵のシステムポリシーとの合成方法
    };
  };
  search: { defaults: { recency_days: number; max_results: number; domains: string[] } };
  server: { debug: boolean; debug_file: string | null; show_config_on_start: boolean };
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
    max_citations: 3,
    system: { source: "builtin", merge: "replace" }
  },
  search: { defaults: { recency_days: 60, max_results: 5, domains: [] } },
  server: { debug: false, debug_file: null, show_config_on_start: false }
};
