
# 正準仕様（Canonical Spec）— `docs/spec.md`
最終更新: 2025-08-24（Asia/Tokyo, AI確認）  
バージョン: **v0.5.x**

本ドキュメントは **openai-responses-mcp** の**唯一の正準仕様**です。  
実装・運用・テストは、必ず本仕様に合致していることを条件とします。

---

## 0. 背景・目的
- Claude Code などの MCP クライアントから、**OpenAI Responses API** を用いた検索付き回答を得るための**軽量な**サーバを提供する。
- 毎リクエストで `tools: [{"type":"web_search"}]` を**常時許可**し、実際に検索を行うかは**モデル側で自律判断**させる。
- 返却は**構造化**（本文・`used_search`・`citations[]`・`model` を必須）し、クライアント側での再利用性を高める。
- 設定で互換モデルへ切替可能（Responses API＋web_search対応モデルに限る）。ポリシー・閾値の変更も設定で柔軟に行える。

非目標：フルブラウザ/クローラ実装、非 stdio トランスポートの即時実装、クライアント側のオーケストレーション。

---

## 1. システム境界・命名
- プロダクト名：**openai-responses-mcp**（パッケージ名/CLI 名も同一）
- サーバ種別：**MCP server**
- 接続方式：**stdio**（JSON-RPC 互換 + `Content-Length` フレーミング）
- 主要ツール：**`answer` / `answer_detailed` / `answer_quick`**
- 推論コア：**OpenAI Responses API**（JS SDK `openai`）
- 検索ツール：**`web_search`**（Responses の内蔵ツール、常時許可）

---

## 2. トランスポート仕様（stdio）
### 2.1 物理レイヤ
- 標準入出力（`stdin`/`stdout`）を使用。UTF-8、BOM なし。
- 各メッセージは以下でフレーミング（優先）：
  ```http
  Content-Length: <bytes>\r\n
  \r\n
  <JSON-utf8>
  ```
  - `<bytes>` は JSON の UTF-8 バイト長。
  - 複数メッセージを連結可能。
  - 互換モード：クライアントが Content-Length を送らない場合、行区切りJSON（NDJSON風）も受理し、以後の応答は行区切りで返す。

### 2.2 論理レイヤ
- JSON-RPC 2.0 互換。`"jsonrpc":"2.0"` を含む。
- サポートメソッド：
  - `initialize`
  - `tools/list`
  - `tools/call`
  - `ping`（任意・ヘルスチェック用。空オブジェクトで成功応答）

### 2.3 初期化（例）
**受信**
```http
Content-Length: 118

{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}
```
**送信**
```http
Content-Length: 142

{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"openai-responses-mcp","version":"<pkg.version>"}}}
```

### 2.4 ツール一覧（例）
```http
Content-Length: 52

{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```
**送信**
```http
Content-Length: 458

{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"answer","description":"必要に応じてWeb検索を実行し、根拠（出典付き）で回答を返す","inputSchema":{"type":"object","properties":{"query":{"type":"string"},"recency_days":{"type":"number"},"max_results":{"type":"number"},"domains":{"type":"array","items":{"type":"string"}},"style":{"enum":["summary","bullets","citations-only"]}},"required":["query"]}}]}} 
```

### 2.5 ツール呼び出し（例）
**受信**
```http
Content-Length: 156

{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"answer","arguments":{"query":"HTTP 404 の意味は？","style":"summary"}}}
```
**送信（成功）**
```http
Content-Length: 204

{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{\"answer\":\"...\",\"used_search\":false,\"citations\":[],\"model\":\"gpt-5.1\"}"}]}}
```

### 2.6 ping（任意）
**受信（例）**
```http
Content-Length: 36

{"jsonrpc":"2.0","id":99,"method":"ping"}
```
**送信（例）**
```http
Content-Length: 28

{"jsonrpc":"2.0","id":99,"result":{}}
```

---

## 3. ツール仕様（マルチプロファイル対応）

### 3.0 ツール概要
本システムは用途に応じて**3つの専用ツール**を提供する：

| ツール名 | 用途 | 設定プロファイル | 特徴 |
|---------|------|----------------|------|
| `answer` | 標準回答（基準） | `model_profiles.answer` | バランスの取れた回答。**必須設定** |
| `answer_detailed` | 詳細分析 | `model_profiles.answer_detailed` | 包括的な調査と深い分析。省略時は`answer`で代替 |
| `answer_quick` | 高速回答 | `model_profiles.answer_quick` | 迅速で簡潔な回答。省略時は`answer`で代替 |

Claude Code等のMCPクライアントは、ユーザーの指示内容に基づいて最適なツールを自動選択する。

### 3.0.1 プロファイル設定の統一仕様
マルチプロファイル設定は以下の統一ルールに従う：

- **`answer`プロファイルは必須**：未設定時は起動時エラー
- **他プロファイルは`answer`で代替**：未設定時は`answer`の設定を使用
- **従来設定は廃止**：`openai.model.default`等は使用しない

**設定例**：
```yaml
model_profiles:
  answer:           # 必須プロファイル
    model: gpt-5.1
    reasoning_effort: medium
    verbosity: medium
  answer_detailed:  # オプション（省略時はanswerで代替）
    model: gpt-5.1-codex
    reasoning_effort: high
    verbosity: high
  # answer_quick は省略 → answer の設定で動作
```

**最小設定**：
```yaml
model_profiles:
  answer:  # 必須のみ設定
    model: gpt-5.1
    reasoning_effort: medium
    verbosity: medium
# 全ツールがこの設定で動作
```
### 3.1 各ツールの仕様

#### 3.1.1 `answer` - 標準回答ツール（基準・必須）
```json
{
  "name": "answer",
  "description": "Search the web when needed and provide balanced, well-sourced answers. This is the standard general-purpose tool.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query":        { "type": "string" },
      "recency_days": { "type": "number" },
      "max_results":  { "type": "number" },
      "domains":      { "type": "array", "items": { "type": "string" } },
      "style":        { "enum": ["summary","bullets","citations-only"] }
    },
    "required": ["query"]
  }
}
```

#### 3.1.2 `answer_detailed` - 詳細分析ツール（オプション）
```json
{
  "name": "answer_detailed",
  "description": "Perform comprehensive analysis with thorough research and detailed explanations. Best for complex questions requiring deep investigation.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query":        { "type": "string" },
      "recency_days": { "type": "number" },
      "max_results":  { "type": "number" },
      "domains":      { "type": "array", "items": { "type": "string" } },
      "style":        { "enum": ["summary","bullets","citations-only"] }
    },
    "required": ["query"]
  }
}
```

#### 3.1.3 `answer_quick` - 高速回答ツール（オプション）
```json
{
  "name": "answer_quick", 
  "description": "Provide fast, concise answers optimized for speed. Best for simple lookups or urgent questions.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": { "type": "string" }
    },
    "required": ["query"]
  }
}
```

**ツール選択指針**:
- **一般的な質問**: `answer`を選択（基準ツール）
- **複雑な分析・比較**: `answer_detailed`を選択
- **簡潔な回答要求**: `answer_quick`を選択

### 3.2 出力契約（MCP テキスト内 JSON）
- `tools/call` のレスポンスは、`content[0].text` に **JSON 文字列**を格納する。
- その JSON は下記スキーマに**厳密に**従う：
```json
{
  "answer": "string",
  "used_search": true,
  "citations": [
    {
      "url": "https://...",
      "title": "string (optional)",
      "published_at": "YYYY-MM-DD (optional)"
    }
  ],
  "model": "used model id (e.g., gpt-5.1)"
}
```
- **順序規約（回答本文側）**：本文 →（必要に応じて）箇条書き →（web_search 使用時のみ）`Sources:` で URL + ISO 日付を併記。

### 3.3 検索判定
- `used_search = true` とする条件：
  - Responses の注釈に `url_citation` が 1 件以上含まれる **または**
  - `web_search` の呼び出しが確認できる場合
- 出典数は `policy.max_citations` を上限（1～10）。

---

## 4. モデル指示（System Policy）
- **必須**：Responses API の `instructions` には **コード側SSOT（`src/policy/system-policy.ts` の `SYSTEM_POLICY`）**を**そのまま**与える（改変禁止）。
- 版識別：`SYSTEM_POLICY_REV` を参照（例: `2025-08-09 v0.4.0`）。
- 役割：web_search の判断、出典・日付の扱い、相対日付の絶対化（Asia/Tokyo）、多言語（日本語優先）などを規定。

---

## 5. 構成・設定
### 5.1 優先順位（厳守）
- **CLI > ENV > YAML > TS defaults**
  - オブジェクトは**深いマージ**
  - 配列は**置換**（連結しない）

### 5.2 YAML 既定パス
- macOS/Linux: `~/.config/openai-responses-mcp/config.yaml`
- Windows: `%APPDATA%\openai-responses-mcp\config.yaml`
- `--config <path>` が指定された場合はそれを最優先する。存在しない場合はスキップしエラーにしない。

### 5.3 代表スキーマ
```yaml
openai:
  api_key_env: OPENAI_API_KEY
  base_url: https://api.openai.com/v1

request: { timeout_ms: 120000, max_retries: 3 }

responses: { stream: false, json_mode: false }

model_profiles:
  answer:           # 必須・基準プロファイル
    model: gpt-5.1
    reasoning_effort: medium
    verbosity: medium
    
  answer_detailed:  # オプション・詳細分析用
    model: gpt-5.1-codex
    reasoning_effort: high
    verbosity: high
    
  answer_quick:     # オプション・高速回答用
    model: gpt-5.1-chat-latest
    reasoning_effort: minimal
    verbosity: low

policy:
  search_triggers: ["今日","現在","最新","速報","価格","値段","リリース","バージョン","セキュリティ","脆弱性","天気","為替","ニュース","サポート期限"]
  prefer_search_when_unsure: true
  max_citations: 3
  requery_attempts: 1
  require_dates_iso: true

search:
  defaults: { recency_days: 60, max_results: 5, domains: [] }

server: { transport: stdio, debug: false, debug_file: null, show_config_on_start: false }
```

### 5.4 主要 ENV
| ENV | 意味 |
|---|---|
| `OPENAI_API_KEY` | 認証（`openai.api_key_env` が指す ENV 名） |
| `OPENAI_API_TIMEOUT` | `request.timeout_ms` |
| `OPENAI_MAX_RETRIES` | `request.max_retries` |
| `SEARCH_RECENCY_DAYS` | `search.defaults.recency_days` |
| `SEARCH_MAX_RESULTS` | `search.defaults.max_results` |
| `MAX_CITATIONS` | `policy.max_citations` |
| `REQUERY_ATTEMPTS` | `policy.requery_attempts` |
| `MODEL_ANSWER` | `model_profiles.answer.model` |
| `MODEL_DETAILED` | `model_profiles.answer_detailed.model` |
| `MODEL_QUICK` | `model_profiles.answer_quick.model` |
| `DEBUG` | `server.debug`/`server.debug_file` |

### 5.5 CLI
```
--stdio                          # stdio サーバ起動（Claude 連携時は必須）
--show-config                    # 実効設定（sources 付き）を JSON でstderrに出力
--config <path>                  # YAML 明示パス
--model <id>                     # model_profiles.answer.model を一時上書き
--help / --version               # そのまま
```

### 5.6 モデル互換性と機能適用範囲
- `verbosity` の適用: モデルIDが `gpt-5` 系（接頭辞が `gpt-5`）のときのみ適用。
- `reasoning_effort` の適用: `gpt-5` / `o3` / `o4` 系モデルで適用。それ以外では無視されるか、OpenAI側でエラーになり得る。
- 非対応モデルを指定した場合: OpenAI Responses API 側の検証でエラーとなる可能性があるため、対応モデルIDのみを指定すること。
- マルチプロファイルの継承: `answer_detailed`/`answer_quick` が未定義の場合は `answer` の設定を継承して動作する（現行実装）。

---

## 6. 実行フロー（マルチプロファイル対応）
1. **ツール判定**：MCPクライアントが`answer`/`answer_detailed`/`answer_quick`から選択。
2. **プロファイル決定**：選択されたツール名に対応する`model_profiles`設定を取得。未設定の場合はエラー。
3. **入力検証**: 各ツールのinputSchemaに従って検証。
4. **Responses 呼び出し（試行）**：
   - `model`: プロファイルの`model`値（例: `o3`, `gpt-4.1-mini`）
   - `instructions`: System Policy（前述）
   - `input`: ユーザ `query`（必要なら追加ヒントに recency/domains を併記）
   - `tools`: `[{"type":"web_search"}]`（常時許可）
   - `text`: `{"verbosity": <profile.verbosity>}`（モデル対応時のみ）
   - `reasoning`: `{"effort": <profile.reasoning_effort>}`（モデル対応時のみ）
   - `timeout_ms`: 設定値
5. **注釈解析**：`url_citation` 等から **URL / title / published_at** を抽出。
6. **`used_search` 判定** と **`citations` 整形**（最大件数適用）。
7. **応答 JSON 構築**（本文・`used_search`・`citations[]`・`model`）。
8. **返送**：MCP レスポンスの `content[0].text` に **JSON 文字列**として格納。

---

### 6.1 キャンセル（MCP notifications/cancelled）

本サーバーは MCP のキャンセル通知に対応する。

- クライアント通知（片方向）
  - `method`: `notifications/cancelled`
  - `params`: `{ requestId: string | number, reason?: string }`
  - 応答は不要（通知のため）。

- サーバー側の動作
  - `tools/call` 開始時に、該当 `id` に対する `AbortController` を作成して登録（`id → controller`）。
  - キャンセル通知（`requestId` が一致）を受領したら、登録済み `AbortController.abort()` を呼び、中断フラグを立てる。
  - 中断済みの要求については、以後その `id` に対する `result`/`error` の送信を抑止する（遅延完了は破棄）。
  - 既に完了・未登録の `requestId` に対する通知は無視する（正常）。
  - `initialize` はキャンセル不可。

- OpenAI 呼び出しとの連携
  - `AbortSignal` を OpenAI SDK（Responses API）呼び出しに伝搬する。
  - リトライ前に `signal.aborted` を確認し、キャンセル時は即座に中断（再試行しない）。

- トランスポート注意
  - 物理的な切断（disconnection）はキャンセルを意味しない。キャンセル意図がある場合、クライアントは必ず `notifications/cancelled` を送ること。

- ログ（DEBUG 時）
  - `cancelled requestId=<id> reason=<...>` を最小限で記録（本文・秘密情報は出さない）。

---

## 7. リトライ戦略
- リトライ対象：HTTP 429 / 5xx / Abort（タイムアウト）
- 戦略：指数バックオフ（実装裁量、合計 `request.max_retries` 回まで）
- 失敗時の処理：エラーとして `tools/call` に返す（`code:-32050` など実装定義）。

---

## 8. セキュリティ / ログ
- API キーは**ENV からのみ**読み、YAML/JSON へ書かない。
- ログに**回答本文やキーをフルで残さない**。必要最小のメタ情報（モデル名/レイテンシ/再試行回数）に限定。
- プロキシ・私設ゲートウェイ利用は組織方針に従う。

### 8.1 デバッグログ（有効条件と単一判定）
- 目的：障害時の切り分け（モデル非対応・タイムアウト・429/5xx・不正引数）を、本文や秘匿情報を出さずに特定する。
- 有効化の入力源（同義、優先度：CLI > ENV > YAML）
  - CLI: `--debug` または `--debug <path>`
  - ENV: `DEBUG=1|true|<path>`
  - YAML: `server.debug: true`（任意で `server.debug_file: <path>`）
- 単一判定：アプリ起動時に最終状態（enabled/file）を一度だけ確定し、以降は共通関数で判定する（`isDebug()`）。モジュール個別に `process.env` を参照しない。
- 出力方針：stderr へ出力（必要に応じて `<path>` にTEEミラー）。API キーや本文、instructions は出力しない。
- 出力内容（例）：
  - server: `tools/call name=<tool> argsKeys=[...] queryLen=<n>`
  - answer: `profile=<name> model=<id> supports={verbosity:<bool>, reasoning:<bool>}`
  - answer: `request summary tools=web_search(<on/off>) reasoning=<on/off> text.verbosity=<on/off>`
  - openai(client): `error attempt=<n> status=<code> name=<err.name> code=<err.code> msg="..." body="<先頭抜粋>"`
- 機密対策：
  - 本文は長さのみ（`queryLen`）を記録。`instructions` は出力しない。
  - レスポンスボディは先頭数百文字に丸め、URL/鍵等が含まれないことを前提に表示。疑義がある場合は出力を抑止。

### 8.2 エラー詳細の JSON-RPC 返却（DEBUG=1 または `--debug` 時のみ）
- 目的：クライアント UI でサーバ stderr を拾えない場合でも、最小限の切り分け情報を可視化する。
- `tools/call` が失敗した場合、`error` の `data` に以下を含める：
  - `message`（先頭 400 文字程度に丸め）
  - `status`（HTTP ステータスや SDK の `code`）
  - `type`（API エラー種別が得られる場合）
  - `name`（例外名）
- 機密対策：本文・instructions・API キーは含めない。必要最小限のメタ情報のみ。

---

## 9. 多言語・日付規則
- 日本語入力→日本語応答。英語入力→英語応答。
- 相対日付（今日/昨日/明日）は **Asia/Tokyo** で**絶対日付**化（`YYYY-MM-DD`）。
- 出典には可能な限り ISO 日付を併記（公開日が無い場合は **アクセス日**）。

---

## 10. 完了の定義（DoD）
- 「HTTP 404 の意味」は `used_search=false`、`citations=[]` で返る。
- 「本日 YYYY-MM-DD の東京の天気」は `used_search=true`、`citations.length>=1`、本文に URL + ISO 日付併記。
- `npm run mcp:smoke` が `initialize → tools/list → tools/call(answer)` の 3 応答を返す。
- `scripts/mcp-smoke*.js` を含む社内スモークスクリプトは、`tools/call` の検索完了を待てるよう `child.kill()` まで **4000ms 以上**待機し、`answer`/`answer_quick` のレスポンス本文を実際に観測できること（強制終了で応答を潰さない）。

---

## 11. 互換性ポリシー / バージョニング
- セマンティックバージョニング：
  - 破壊的変更 → **MAJOR**
  - 新機能追加（後方互換）→ **MINOR**
  - バグ修正/依存更新 → **PATCH**
- MCP プロトコル `protocolVersion` は現行 **`2025-06-18`**。将来の変更は後方互換を維持し、`initialize` でネゴシエーション。

---

## 12. 参考ファイル（仕様の一部）
- `docs/reference/system-policy.md` — **Instructions 本文**（貼付用・改変禁止）
- `docs/reference/config-reference.md` — 設定スキーマと優先順位の詳細
- `config/config.yaml.example` — 設定例（YAML）

---

## 13. 非機能要件（抜粋）
- **安定運用**：beta/alpha を避け、**正式リリース**された SDK/ランタイムのみ使用（npm/Node）。
- **再現性**：`--show-config` による実効設定の保存を推奨（`docs/reference/reproducibility.md`）。
- **セキュリティ**：秘密は ENV のみ、ログ最小化。

---

<!-- 将来拡張（設計のみ）: 未定事項のため公開版から削除 -->

## 15. npm 配布メタデータ（package.json 公開仕様）
本セクションは npm 公開時の `package.json` の必須/推奨項目を定義する。公開前には本仕様と一致していることを確認すること。

### 15.1 必須項目
- name: `openai-responses-mcp`
- version: セマンティックバージョニング（現行 `0.4.x`）
- description: 以下の文言を使用（段階表現「Step N:」は含めない）
  - `Lightweight MCP server (Responses API core). OpenAI integration + web_search.`
- type: `module`
- bin: `{ "openai-responses-mcp": "build/index.js" }`
- files: `["build","config/config.yaml.example","config/policy.md.example","README.md","LICENSE"]`
- scripts.prepublishOnly: `npm run build`
- engines.node: `>=20`
- license: `MIT`

### 15.2 推奨メタ（npm ページの利便性向上）
- repository: `{ "type": "git", "url": "git+https://github.com/uchimanajet7/openai-responses-mcp.git" }`
- homepage: `https://github.com/uchimanajet7/openai-responses-mcp#readme`
- bugs: `{ "url": "https://github.com/uchimanajet7/openai-responses-mcp/issues" }`
- keywords: 適宜（例: `"mcp","openai","responses","cli"`）
- author: 適宜

### 15.3 公開用 `package.json` 例（抜粋）
```json
{
  "name": "openai-responses-mcp",
  "version": "0.4.1",
  "description": "Lightweight MCP server (Responses API core). OpenAI integration + web_search.",
  "type": "module",
  "bin": { "openai-responses-mcp": "build/index.js" },
  "files": [
    "build",
    "config/config.yaml.example",
    "config/policy.md.example",
    "README.md",
    "LICENSE"
  ],
  "scripts": { "prepublishOnly": "npm run build" },
  "engines": { "node": ">=20" },
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/uchimanajet7/openai-responses-mcp.git" },
  "homepage": "https://github.com/uchimanajet7/openai-responses-mcp#readme",
  "bugs": { "url": "https://github.com/uchimanajet7/openai-responses-mcp/issues" }
}
```

### 15.4 適用・検証フロー
1) 仕様との差分を洗い出す（`description` に「Step N:」が残っていないか確認）。
2) `repository/homepage/bugs` を本仕様のURLで追加。
3) `npm run build:clean && npm pack --dry-run` で同梱物とメタを確認。
4) 変更理由と影響範囲を `docs/changelog.md` に追記（ユーザー可視）。

注記：本仕様は公開メタデータの最低限を定めるものであり、依存やスクリプトの詳細は上位セクション（機能仕様）に従う。

---

## 付録 A. `answer` の I/O 例
### A.1 入力（tools/call → arguments）
```json
{
  "query": "本日 2025-08-09 の東京の天気は？",
  "recency_days": 60,
  "max_results": 5,
  "domains": ["jma.go.jp","tenki.jp"],
  "style": "summary",
  "verbosity": "medium",
  "reasoning_effort": "minimal"
}
```

### A.2 出力（tools/call ← content[0].text）
```json
{
  "answer": "2025-08-09（JST）の東京都の天気は……（略）。\n\nSources:\n- https://www.jma.go.jp/... (2025-08-09)",
  "used_search": true,
  "citations": [{"url":"https://www.jma.go.jp/...","title":"気象庁｜天気予報","published_at":"2025-08-09"}],
  "model": "gpt-5.1"
}
```

---

## 付録 B. エラー例（実装指針）
- 入力不備：
  ```json
  {"code":-32001,"message":"answer: invalid arguments","data":{"reason":"query is required"}}
  ```
- プロファイル未設定：
  ```json
  {"code":-32052,"message":"model_profiles.answer is required"}
  ```
- API エラー（429/5xx）：指数バックオフ後も失敗した場合：
  ```json
  {"code":-32050,"message":"openai responses failed","data":{"retries":3}}
  ```

## 16. バージョニング / Changelog / Lockfile 運用方針

### 16.1 バージョニング（SemVer / SSOT）
- バージョンの**唯一の出所（SSOT）**は `package.json` の `version`。
- 破壊的変更=MAJOR、後方互換の機能追加=MINOR、修正=PATCH。
- `package-lock.json` の `version` を**手動で書き換えない**（`npm install` が自動整合）。
- Node は `engines.node: ">=20"` を満たすこと。

### 16.2 Changelog（Keep a Changelog 準拠）
- 位置: `docs/changelog.md`。
- 形式: Keep a Changelog 準拠。セクション順は `Unreleased` → 過去リリース（新しい順）。
- タイムゾーン: 日付は Asia/Tokyo。
- 区分例: Added / Changed / Fixed / Removed / Deprecated / Security。
- プレリリース期間（〜v1.0.0）: `Unreleased` に集約し、必要時に `vx.y.z — YYYY-MM-DD` として確定。
- リリース確定時: `Unreleased` から該当差分を抜き出し、日付入りで新セクションを作成。

### 16.3 Lockfile 運用（npm lockfile v3）
- `package-lock.json` は**VCS にコミット**する（再現性のため）。
- 再生成は **`package.json` 側がソース**。ロックは手動編集禁止。
- 生成/再生成の手順（再現性の優先度が高い順）:

  1) クリーン再解決（推奨）
  ```bash
  rm -rf node_modules package-lock.json
  npm install
  ```

  2) 迅速な再解決（最小作業）
  ```bash
  rm -f package-lock.json
  npm install
  ```

  3) 既存 lock からの再現インストール（再生成はしない）
  ```bash
  npm ci
  ```

- CI/配布: lockfile v3 を前提（npm v9+ / Node 20+ を推奨）。

以上。

---

## 11. CI/CD 仕様（GitHub Actions）
本節は docs/release.md（フェーズB/C）の運用方針を正準仕様としてまとめたもの。実装時は本仕様に完全準拠する。

### 11.1 ブランチ/タグ運用
- `main`: リリース対象ブランチ。
- `feature/*`: 機能開発ブランチ（PR前提）。
- タグ: `vX.Y.Z` 形式のみをリリーストリガに使用（SemVer）。
  - バージョンの決定は手動で `package.json` を bump → `git tag vX.Y.Z` → `git push --tags`。

### 11.2 ワークフロー構成
- `ci.yml`（PR/Push 検証）
  - トリガ: `pull_request`（全ブランチ）/ `push`（`main`）。
  - Node: `20.x`（actions/setup-node@v4）。
  - 手順:
    1) `actions/checkout@v4`
    2) `actions/setup-node@v4`（`node-version: 20`, `cache: npm`）
    3) `npm ci`
    4) `npm run build:clean`
    5) `npm pack --dry-run`（同梱物確認）
    6) スモークテスト:
       - 既定: `npm run mcp:smoke:ldjson`（OpenAI鍵不要）
       - 任意: `npm run mcp:smoke`（`OPENAI_API_KEY` を設定した場合のみ実行）

- `release.yml`（タグ push: 自動リリース — Trusted Publishing を採用）
  - トリガ: `push` with `tags: ["v*"]`
  - 権限: `permissions: { contents: write, id-token: write }`
  - Node: `20.x`
  - npm 公開設定（Trusted Publishing / OIDC）:
    - npmjs 側で当該 GitHub リポジトリを Trusted Publishers に登録（初回のみ）
    - Actions 側は `npm publish --provenance --access public` を実行（トークン不要）
  - 任意: GitHub Release ノート生成

### 11.3 シークレット/環境変数
- `OPENAI_API_KEY`（任意・ci.yml）: `npm run mcp:smoke` 実行時に必要。未設定の場合は `mcp:smoke:ldjson` のみ実行。
- Trusted Publishing では `NPM_TOKEN` は不要。npmjs 側で Trusted Publishers を設定する。

### 11.4 参考 YAML（概要）
以下は実装の骨子（実装時はこの仕様を忠実に反映し、重複や余分な手順は追加しない）。

ci.yml（概要）:
```yaml
name: CI
on:
  pull_request:
  push:
    branches: ["main"]
jobs:
  build:
    runs-on: ubuntu-latest
    env:
      # 鍵がある場合のみ鍵依存テストを実行するため、ジョブenvにバインド。
      OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build:clean
      - run: npm pack --dry-run
      - run: npm run mcp:smoke:ldjson
      - if: env.OPENAI_API_KEY != ''
        run: npm run mcp:smoke
```

release.yml（概要 — Trusted Publishing）:
```yaml
name: Release
on:
  push:
    tags: ["v*"]
permissions:
  contents: write
  id-token: write
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build:clean
      - run: npm publish --provenance --access public
```

### 11.5 成果物と公開ポリシー
- `package.json.files` に指定された最小セットのみを公開（`build/`, `config/*.example`, `README.md`, `LICENSE`, `package.json`）。
- `prepublishOnly`: `npm run build` を保持（ローカル publish も同一挙動）。
- 公開後の検証: `npx openai-responses-mcp@latest --stdio` で起動確認。

### 11.6 運用フロー（再掲・確定）
1) feature/* → Pull Request（`ci.yml` 実行）
2) `main` にマージ後、`package.json` を semver で bump
3) `git tag vX.Y.Z && git push --tags`（`release.yml` 実行 → npm publish（Trusted Publishing））
4) Actions の成功確認 → README の npx 例で動作確認

注: `repository`/`homepage`/`bugs` の `package.json` 追記は npm ページ表示改善のため推奨だが、実装は別途合意の上で行う。
