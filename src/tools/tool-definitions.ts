// マルチプロファイル対応のツール定義
export const AVAILABLE_PROFILES = [
  "answer",           // 基準プロファイル。必須。
  "answer_detailed",  // 詳細分析プロファイル
  "answer_quick"      // 高速プロファイル
] as const;

export const TOOL_DEFINITIONS = {
  answer: {
    name: "answer",
    description: "Search the web when needed and provide balanced, well-sourced answers. This is the standard general-purpose tool.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        recency_days: { type: "number" },
        max_results: { type: "number" },
        domains: { type: "array", items: { type: "string" } }
      },
      required: ["query"]
    }
  },
  
  answer_detailed: {
    name: "answer_detailed", 
    description: "Perform comprehensive analysis with thorough research and detailed explanations. Best for complex questions requiring deep investigation.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        recency_days: { type: "number" },
        max_results: { type: "number" },
        domains: { type: "array", items: { type: "string" } }
      },
      required: ["query"]
    }
  },
  
  answer_quick: {
    name: "answer_quick",
    description: "Provide fast, concise answers optimized for speed. Best for simple lookups or urgent questions.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" }
      },
      required: ["query"]
    }
  }
} as const;
