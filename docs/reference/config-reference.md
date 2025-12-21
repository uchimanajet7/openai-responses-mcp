
# 設定リファレンス — `docs/reference/config-reference.md`
最終更新: 2025-12-19（Asia/Tokyo, AI確認）

本ドキュメントは **openai-responses-mcp** の設定仕様を完全記述します。  
設定の**優先順位**は **CLI > ENV > YAML > TS defaults**（後勝ち、オブジェクトは深いマージ／配列は置換）。

---

## 1. ロード順序と優先規則

1. **TS defaults**（ソース内の既定値）
2. **YAML**（`--config <path>` または既定パス）
3. **ENV**（環境変数）
4. **CLI**（`--model` など）

- **マージ規則**：オブジェクトは深いマージ。**配列は置換**（連結しない）。  
- 実際に適用された最終値は `--show-config` で確認できます（`sources` にどこから反映されたかも出力）。出力先はstderrです。

---

## 2. 既定の YAML パス

- macOS/Linux: `~/.config/openai-responses-mcp/config.yaml`  
- Windows: `%APPDATA%\openai-responses-mcp\config.yaml`

`--config <path>` を指定すると、そのパスを使用します。存在しない場合は YAML はスキップされます。

---

## 3. 設定スキーマ（論理構造）

```yaml
openai:
  api_key_env: string              # 例: OPENAI_API_KEY（ENV名）
  base_url: string                 # 例: https://api.openai.com/v1

# マルチプロファイル設定
model_profiles:
  answer:                          # 基準ツール（必須）
    model: string                  # 例: gpt-5.2
    reasoning_effort: string       # low|medium|high|xhigh（推奨）
    verbosity: string              # low|medium|high
  answer_detailed:                 # 詳細分析（オプション）
    model: string                  # 例: gpt-5.1-codex
    reasoning_effort: string
    verbosity: string
  answer_quick:                    # 高速回答（オプション）
    model: string                  # 例: gpt-5.2-chat-latest
    reasoning_effort: string
    verbosity: string

request:
  timeout_ms: number               # 例: 300000（ms）
  max_retries: number              # 0..10 を推奨

policy:
  prefer_search_when_unsure: boolean
  max_citations: number            # 1..10
  require_dates_iso: boolean
  system:
    source: "builtin" | "file"     # 既定 builtin（YAMLのみで制御）
    path: string                   # 例: ~/.config/openai-responses-mcp/policy.md
    merge: "replace"|"prepend"|"append" # 既定 replace

search:
  defaults:
    recency_days: number           # >=0
    max_results: number            # 1..10
    domains: string[]              # 優先ドメイン（空可）

server:
  transport: "stdio"               # 既定 "stdio"
  debug: boolean                   # 既定 false（ONで詳細ログ）
  debug_file: string|null          # 既定 null（パス指定時はファイル＋画面ミラー）
  show_config_on_start: boolean    # 既定 false（起動時にstderrへ実効設定の要約を出力）
```

---

## 4. 既定値（TS defaults）

```yaml
openai:
  api_key_env: OPENAI_API_KEY
  base_url: https://api.openai.com/v1

# マルチプロファイル既定値
model_profiles:
  answer: { model: gpt-5.2, reasoning_effort: medium, verbosity: medium }

request: { timeout_ms: 300000, max_retries: 3 }

policy:
  prefer_search_when_unsure: true
  max_citations: 3
  require_dates_iso: true

search:
  defaults: { recency_days: 60, max_results: 5, domains: [] }

server: { transport: stdio, debug: false, debug_file: null, show_config_on_start: false }
```

---

## 5. YAML の完全例

### 5.1 最小
```yaml
model_profiles:
  answer:
    model: gpt-5.2
    reasoning_effort: medium
    verbosity: medium
```

### 5.2 代表例（推奨）
```yaml
openai:
  api_key_env: OPENAI_API_KEY
  base_url: https://api.openai.com/v1

# マルチプロファイル設定（v0.4.0+）
model_profiles:
  answer_detailed:
    model: gpt-5.1-codex
    reasoning_effort: high
    verbosity: high
  answer:
    model: gpt-5.2
    reasoning_effort: medium
    verbosity: medium
  answer_quick:
    model: gpt-5.2-chat-latest
    reasoning_effort: low
    verbosity: low

request:
  timeout_ms: 300000
  max_retries: 3

policy:
  prefer_search_when_unsure: true
  max_citations: 3
  require_dates_iso: true

search:
  defaults:
    recency_days: 60
    max_results: 5
    domains: []

server:
  transport: stdio
  debug: true
  debug_file: ./_debug.log
  show_config_on_start: true
```

---

## 6. 環境変数（ENV）

> ここに列挙される ENV がセットされている場合、**YAML より優先**されます。

| ENV 名 | 型/範囲 | 反映先 | 説明 |
|---|---|---|---|
| `OPENAI_API_KEY` | string | OpenAI 認証 | **必須**。`openai.api_key_env` が指す ENV 名（変更可能）。 |
| `OPENAI_API_TIMEOUT` | number(ms) | `request.timeout_ms` | >0 |
| `OPENAI_MAX_RETRIES` | integer | `request.max_retries` | 0..10 |
| `SEARCH_MAX_RESULTS` | integer | `search.defaults.max_results` | 1..10 |
| `SEARCH_RECENCY_DAYS` | integer | `search.defaults.recency_days` | >=0 |
| `MAX_CITATIONS` | integer | `policy.max_citations` | 1..10 |
| `DEBUG` | 1/true/path | `server.debug`/`server.debug_file` | `1|true` でON、`<path>` でファイルにTEEミラー |
| `MODEL_ANSWER` | string | `model_profiles.answer.model` | クイック上書き（恒久はYAMLで設定） |
| `ANSWER_EFFORT` | enum | `model_profiles.answer.reasoning_effort` | `low`/`medium`/`high`/`xhigh` |
| `ANSWER_VERBOSITY` | enum | `model_profiles.answer.verbosity` | `low`/`medium`/`high` |

> `openai.api_key_env` を `MY_KEY` に変えた場合、**`MY_KEY`** を設定してください。`OPENAI_API_KEY` は見られません。

補足（デバッグ有効化の単一判定）
- デバッグは CLI / ENV / YAML を同義とし、優先度は **CLI > ENV > YAML**。
- アプリ起動時に最終状態（enabled/file）を確定し、以降は共通判定（`isDebug()`）に従う。
- YAML のみで `server.debug: true` が指定された場合でも、すべてのモジュールで等しくデバッグログが有効になる。

---

## 7. CLI オプション（設定関連）

```text
--show-config [--config <path>]
--config <path>     : YAML の明示パス（省略時は既定パス）
```

出力はstderrです。例：
```bash
node build/index.js --show-config 2> effective-config.json
```

---

## 8. 実効設定の確認（出力例）

```json
{
  "version": "<pkg.version>",
  "sources": {
    "ts_defaults": true,
    "yaml": "/home/user/.config/openai-responses-mcp/config.yaml",
    "env": [],
    "cli": []
  },
  "effective": {
    "openai": { "api_key_env": "OPENAI_API_KEY", "base_url": "https://api.openai.com/v1" },
    "model_profiles": { "answer": { "model": "gpt-5.2", "reasoning_effort": "medium", "verbosity": "medium" } },
    "request": { "timeout_ms": 300000, "max_retries": 3 },
    
    "policy": { "prefer_search_when_unsure": true, "max_citations": 3, "require_dates_iso": true },
    "search": { "defaults": { "recency_days": 60, "max_results": 5, "domains": [] } },
    "server": { "transport": "stdio", "debug": true, "debug_file": "./_debug.log", "show_config_on_start": true }
  }
}
```

---

## 9. 制約（バリデーションの目安）
- `request.timeout_ms` > 0  
- `request.max_retries` ∈ [0,10]  
- `policy.max_citations` ∈ [1,10]  
- `policy.requery_attempts` ∈ [0,3]  
- `search.defaults.max_results` ∈ [1,10]  
- `search.defaults.recency_days` ≥ 0  
  

不正な値はエラーとは限らず、そのまま適用される場合があります。CI で `--show-config` の JSON（stderr）を検査することを推奨します。

---

## 10. セキュリティ注意
- **API キーは YAML に書かない**。常に ENV（`openai.api_key_env` が指す変数）から取得。
- `base_url` を私設プロキシに向ける場合は、組織のセキュリティ方針に従ってください。

---

<!-- 追加パラメータの検討（未定事項）は docs/_drafts/config-additional-params.md へ退避 -->

## 12. よくある質問（抜粋）
- **Q: YAML が無くても動く？** → はい。TS defaults と ENV/CLI だけでも動作します。  
- **Q: `domains` を複数入れたら？** → ヒントとして渡され、モデルの検索判断に影響します（強制フィルタではありません）。  
- **Q: `web_search` を常時許可するのはなぜ？** → 「必要と判断したら実行」をモデルに委ね、**時事性**の取りこぼしを防ぐためです。
