
# 正準仕様。Canonical Spec。 `docs/spec.md`
最終更新: 2026-01-14 Asia/Tokyo  
バージョン: **v0.9.0**

本ドキュメントは **openai-responses-mcp** の仕様を説明します。  
仕様・挙動は実装を正とします。実装と差異がある場合はドキュメント側を修正します。

---

## 0. 背景・目的
- Claude Code などの MCP クライアントから、**OpenAI Responses API** を用いた検索付き回答を得るための**軽量な**サーバを提供する。
- 毎リクエストで `tools: [{"type":"web_search"}]` を**常時許可**し、実際に検索を行うかは**モデル側で自律判断**させる。
- 返却は**構造化**し、`answer`（本文）・`used_search`・`citations[]`・`model` を必須とする。クライアント側での再利用性を高める。
- 設定で互換モデルへ切替可能。ただし Responses API + web_search 対応モデルに限る。ポリシー・閾値の変更も設定で柔軟に行える。

非目標：フルブラウザ/クローラ実装、非 stdio トランスポートの即時実装、クライアント側のオーケストレーション。

---

## 1. システム境界・命名
- プロダクト名：**openai-responses-mcp**。パッケージ名/CLI 名も同一。
- サーバ種別：**MCP server**
- 接続方式：**stdio**。JSON-RPC 互換で、`Content-Length` によるフレーミングを行う。
- 主要ツール：**`answer` / `answer_detailed` / `answer_quick`**
- 推論コア：**OpenAI Responses API**。JS SDK は `openai` を使用する。
- 検索ツール：**`web_search`**。Responses の内蔵ツールで、常時許可する。

---

## 2. トランスポート仕様。stdio を使用する。
### 2.1 物理レイヤ
- 標準入出力は `stdin` と `stdout` を使用する。文字コードは UTF-8、BOM なし。
- 各メッセージは以下でフレーミングする。優先方式である。
  ```http
  Content-Length: <bytes>\r\n
  \r\n
  <JSON-utf8>
  ```
  - `<bytes>` は JSON の UTF-8 バイト長。
  - 複数メッセージを連結可能。
  - 互換モード：クライアントが Content-Length を送らない場合、行区切り JSON を受理する。形式は NDJSON 風である。その場合、以後の応答は行区切りで返す。

### 2.2 論理レイヤ
- JSON-RPC 2.0 互換。`"jsonrpc":"2.0"` を含む。
- サポートメソッド：
  - `initialize`
  - `tools/list`
  - `tools/call`
  - `ping`：任意。ヘルスチェック用。空オブジェクトで成功応答。

### 2.3 初期化の例
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

### 2.4 ツール一覧の例
```http
Content-Length: 52

{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```
**送信**
```http
Content-Length: <bytes>

{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"answer","description":"Search the web when needed and provide balanced, well-sourced answers. This is the standard general-purpose tool.","inputSchema":{"type":"object","properties":{"query":{"type":"string"},"recency_days":{"type":"number"},"max_results":{"type":"number"},"domains":{"type":"array","items":{"type":"string"}}},"required":["query"]}},{"name":"answer_detailed","description":"Perform comprehensive analysis with thorough research and detailed explanations. Best for complex questions requiring deep investigation.","inputSchema":{"type":"object","properties":{"query":{"type":"string"},"recency_days":{"type":"number"},"max_results":{"type":"number"},"domains":{"type":"array","items":{"type":"string"}}},"required":["query"]}},{"name":"answer_quick","description":"Provide fast, concise answers optimized for speed. Best for simple lookups or urgent questions.","inputSchema":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}}]}} 
```

### 2.5 ツール呼び出しの例
**受信**
```http
Content-Length: 156

{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"answer","arguments":{"query":"HTTP 404 の意味は？"}}}
```
**送信。成功時（本文は `answer` に格納）。**
```http
Content-Length: 204

{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{\"answer\":\"...\",\"used_search\":false,\"citations\":[],\"model\":\"gpt-5.2\"}"}]}}
```

### 2.6 ping
このメソッドは任意です。
**受信例**
```http
Content-Length: 36

{"jsonrpc":"2.0","id":99,"method":"ping"}
```
**送信例**
```http
Content-Length: 28

{"jsonrpc":"2.0","id":99,"result":{}}
```

---

## 3. ツール仕様。マルチプロファイルに対応する。

### 3.0 ツール概要
本システムは用途に応じて**3つの専用ツール**を提供する：

| ツール名 | 用途 | 設定プロファイル | 特徴 |
|---------|------|----------------|------|
| `answer` | 標準回答。基準。 | `model_profiles.answer` | バランスの取れた回答。**必須設定** |
| `answer_detailed` | 詳細分析 | `model_profiles.answer_detailed` | 包括的な調査と深い分析。省略時は`answer`で代替 |
| `answer_quick` | 高速回答 | `model_profiles.answer_quick` | 迅速で簡潔な回答。省略時は`answer`で代替 |

Claude Code等のModel Context Protocol (MCP)クライアントは、ユーザーの指示内容に基づいてツールを選択できる。実際の選択ロジックはクライアント実装に依存する。

### 3.0.1 プロファイル設定の統一仕様
マルチプロファイル設定は以下の統一ルールに従う：

- **`answer`プロファイルは必須**：未定義の場合は answer ツールの`tools/call`でエラーとなる
- **他プロファイルは`answer`で代替**：未設定時は`answer`の設定を使用
- **従来設定は廃止**：`openai.model.default`等は使用しない

**設定例**：
```yaml
model_profiles:
  answer:           # 必須プロファイル
    model: gpt-5.2
    reasoning_effort: medium
    verbosity: medium
  answer_detailed:  # オプション。省略時は answer で代替。
    model: gpt-5.1-codex
    reasoning_effort: high
    verbosity: high
  # answer_quick は省略 → answer の設定で動作
```

**最小設定**：
```yaml
model_profiles:
  answer:  # 必須のみ設定
    model: gpt-5.2
    reasoning_effort: medium
    verbosity: medium
# 全ツールがこの設定で動作
```
### 3.1 各ツールの仕様

#### 3.1.1 `answer` - 標準回答ツール。基準。必須。
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
      "domains":      { "type": "array", "items": { "type": "string" } }
    },
    "required": ["query"]
  }
}
```

#### 3.1.2 `answer_detailed` - 詳細分析ツール。オプション。
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
      "domains":      { "type": "array", "items": { "type": "string" } }
    },
    "required": ["query"]
  }
}
```

#### 3.1.3 `answer_quick` - 高速回答ツール。オプション。
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
- **一般的な質問**: `answer` を選択する。基準ツールである。
- **複雑な分析・比較**: `answer_detailed` を選択する。
- **簡潔な回答要求**: `answer_quick` を選択する。

### 3.2 出力契約。MCP テキスト内の JSON。
- `tools/call` のレスポンスは、`content[0].text` に **JSON 文字列**を格納する。
- その JSON は下記スキーマに**厳密に**従う：
```json
{
  "answer": "string",
  "used_search": true,
  "citations": [
    {
      "url": "https://... または source ID。例: oai-weather。URL が提供されない場合は source ID を用いる。",
      "title": "optional string",
      "published_at": "YYYY-MM-DD"
    }
  ],
  "model": "used model id. Example: gpt-5.2"
}
```
- **answer（本文）側の順序規約**：answer（本文）→ 必要に応じて箇条書き → web_search を使った場合は `Sources:` で **情報源 + ISO 日付**を併記。
  - 情報源は URL が取れる場合は URL を用いる。URL が取れない場合は `oai-weather` 等のソース識別子を用いる。ソース識別子は `web_search_call.action.sources` の `api` ソース等。

### 3.3 検索判定
- `used_search = true` とする条件：
  - Responses の注釈に `url_citation` が 1 件以上含まれる **または**
  - `web_search` の呼び出しが確認できる場合
- 出典数は `policy.max_citations` を上限とする。範囲は 1～10。

---

## 4. モデル指示。System Policy。
- **必須**：Responses API の `instructions` は既定で `src/policy/system-policy.ts` の `SYSTEM_POLICY` を使う。YAML の `policy.system` で外部 `policy.md` に置換するか合成して使う。
- 版識別：`SYSTEM_POLICY_REV` を参照。例: `2025-12-21 v0.9.0`.
- 役割：web_search の判断、出典・日付の扱い、相対日付を Asia/Tokyo で絶対化する扱い、多言語などを規定。

---

## 5. 構成・設定
### 5.1 優先順位。厳守。
- **ENV > YAML > TS defaults**
  - オブジェクトは**深いマージ**
  - 配列は**置換**する。連結しない。

### 5.2 YAML 既定パス
- 既定パス: `~/.config/openai-responses-mcp/config.yaml`
- `--config <path>` を指定した場合はそのファイルを読む。指定しない場合は上記の既定パスを読む。YAML 設定は任意。

### 5.3 代表スキーマ
```yaml
openai:
  api_key_env: OPENAI_API_KEY
  base_url: https://api.openai.com/v1

request: { timeout_ms: 300000, max_retries: 3 }

model_profiles:
  answer:           # 必須・基準プロファイル
    model: gpt-5.2
    reasoning_effort: medium
    verbosity: medium
    
  answer_detailed:  # オプション・詳細分析用
    model: gpt-5.1-codex
    reasoning_effort: high
    verbosity: high
    
  answer_quick:     # オプション・高速回答用
    model: gpt-5.2-chat-latest
    reasoning_effort: low
    verbosity: low

policy:
  max_citations: 3

search:
  defaults: { recency_days: 60, max_results: 5, domains: [] }

server: { debug: false, debug_file: null, show_config_on_start: false }
```

### 5.4 主要 ENV
| ENV | 意味 |
|---|---|
| `OPENAI_API_KEY` | 認証。`openai.api_key_env` が指す ENV 名。 |
| `OPENAI_API_TIMEOUT` | `request.timeout_ms` |
| `OPENAI_MAX_RETRIES` | `request.max_retries` |
| `SEARCH_RECENCY_DAYS` | `search.defaults.recency_days` |
| `SEARCH_MAX_RESULTS` | `search.defaults.max_results` |
| `MAX_CITATIONS` | `policy.max_citations` |
| `MODEL_ANSWER` | `model_profiles.answer.model` |
| `ANSWER_EFFORT` | `model_profiles.answer.reasoning_effort` |
| `ANSWER_VERBOSITY` | `model_profiles.answer.verbosity` |
| `DEBUG` | `server.debug`/`server.debug_file` |
| `MCP_LINE_MODE` | `1` の場合、MCP stdio のサーバ応答を `JSON + \n` で送信する |

### 5.5 CLI
```
--stdio                          # stdio サーバ起動。Claude と連携する場合は必須。
--show-config                    # 実効設定。sources 付き。JSON を stderr に出力する。
--config <path>                  # YAML 明示パス
--debug [<path>]                 # デバッグ有効化。stderr。指定時はファイルへ TEE ミラーする。
--help / --version               # そのまま
```

### 5.6 モデル互換性と機能適用範囲
- `verbosity` の適用: モデルIDの接頭辞が `gpt-5` のときのみ適用する。
- `reasoning_effort` は `gpt-5` / `o3` / `o4` 系モデルでのみ有効。その他のモデルでは OpenAI Responses API の検証結果に従う（エラーとなる場合がある）。
- `reasoning_effort` の値: `low` / `medium` / `high` / `xhigh`。既定は `medium`。`xhigh` は extra high。
- 互換性エラーを避けるため、対応モデルIDのみを指定する。
- マルチプロファイルの継承: `answer_detailed`/`answer_quick` が未定義の場合、`answer` の設定を継承して動作する。

---

## 6. 実行フロー。マルチプロファイル対応。
1. **ツール判定**：MCPクライアントが`answer`/`answer_detailed`/`answer_quick`から選択。
2. **プロファイル決定**：選択されたツール名に対応する`model_profiles`設定を取得する。未定義なら`answer`の設定を使う。
3. **入力検証**: 入力は上流で検証する前提とし、サーバ側では追加の検証を行わない。
4. **Responses 呼び出し。試行。**：
   - `model`: プロファイルの`model`値。例: `o3`, `gpt-4.1-mini`.
   - `instructions`: System Policy。4章に従い `src/policy/system-policy.ts` の `SYSTEM_POLICY` を用いる。
- `input`: ユーザ `query` に `recency_days` と `max_results` のヒントを常に付与する。 `domains` は指定がある場合のみ追加する。
   - `tools`: `[{"type":"web_search"}]`。web_search は常時許可する。
   - `include`: `["web_search_call.action.sources"]`。検索で参照した **情報源一覧** を取得する。情報源は URL または情報源ID。`url_citation` が得られない場合のフォールバック、および「どこから検索したか」の補完に使用する。
   - `text`: `{"verbosity": <profile.verbosity>}`。モデルが対応する場合のみ適用する。
   - `reasoning`: `{"effort": <profile.reasoning_effort>}`。モデルが対応する場合のみ適用する。
  - `timeout_ms`: リクエスト本文には含めない。クライアント側のタイムアウトとして適用し、`AbortController` で中断する。
5. **注釈解析**：Responses の `url_citation` 注釈から **URL / title** を抽出する。これは優先する。併せて `web_search_call.action.sources` から **情報源** を抽出する。情報源は URL またはソース識別子。`url_citation` が 0 件の場合は sources 由来を採用する。`url_citation` がある場合も URL 以外の情報源IDは併記して「検索元」を落とさない。
6. **`used_search` 判定** と **`citations` 整形**：最大件数を適用。
   - `used_search=true` の条件は 3.3 に従う。
   - `citations[]` は `url_citation` 由来を優先する。`url_citation` が 0 件の場合は `web_search_call.action.sources` 由来で補完する。補完内容は URL と情報源ID。`url_citation` がある場合も **URL 以外の情報源ID** は併記して「どこから検索したか」を維持する。
   - 日付は、公開日が取れない場合は **アクセス日**を Asia/Tokyo の ISO 形式 `YYYY-MM-DD` で用いる。
7. **応答 JSON 構築**：`answer`（本文）・`used_search`・`citations[]`・`model` を含める。
   - `used_search=true` のときは `answer` の本文末尾に `Sources:` を必ず付与し、情報源 + ISO日付を併記する。付与の担保はサーバ側の責務とし、3.2 の出力契約を満たす。
8. **返送**：MCP レスポンスの `content[0].text` に **JSON 文字列**として格納。

---

### 6.1 キャンセル。MCP notifications/cancelled。

本サーバーは MCP のキャンセル通知に対応する。

- クライアント通知。片方向。
  - `method`: `notifications/cancelled`
  - `params`: `{ requestId: string | number, reason?: string }`
  - 通知のため、応答は不要。

- サーバー側の動作
  - `tools/call` 開始時に、該当 `id` に対する `AbortController` を作成して登録する。`id → controller`。
  - キャンセル通知を受領したら、`requestId` が一致する場合に登録済み `AbortController.abort()` を呼ぶ。中断フラグを立てる。
  - 中断済みの要求については、以後その `id` に対する `result`/`error` の送信を抑止する。遅延完了は破棄する。
  - 既に完了・未登録の `requestId` に対する通知は無視する。正常。
  - `initialize` は仕様上キャンセル対象にしない。

- OpenAI 呼び出しとの連携
  - `AbortSignal` を OpenAI SDK の Responses API 呼び出しに伝搬する。
  - リトライ前に `signal.aborted` を確認し、キャンセル時は即座に中断する。再試行しない。

- トランスポート注意
  - 物理的な切断はキャンセルを意味しない。disconnection。キャンセル意図がある場合、クライアントは必ず `notifications/cancelled` を送ること。

- ログ。DEBUG 時。
  - `cancelled requestId=<id> reason=<...>` を最小限で記録する。本文・秘密情報は出さない。

---

## 7. リトライ戦略
- リトライ対象：HTTP 429 / 5xx
- タイムアウト/キャンセル。AbortError。再試行せず中断する。
- 戦略：指数バックオフ。実装裁量。合計 `request.max_retries` 回まで。
- 失敗時の処理：エラーとして `tools/call` に返す。`code:-32050` などは実装定義。

---

## 8. セキュリティ / ログ
- API キーは**ENV からのみ**読み、YAML/JSON へ書かない。
- ログは通常は最小限。デバッグ有効時は送受信 JSON と動作要約を stderr に出力するため回答本文が含まれる。
- プロキシ・私設ゲートウェイ利用は組織方針に従う。

### 8.1 デバッグログ。有効条件と単一判定。
- 目的：障害時の切り分けとして、モデル非対応・タイムアウト・429/5xx・不正引数を確認する。デバッグログには送受信 JSON が出力されるため回答本文が含まれる。
- 有効化の入力源。いずれも同義。優先度：CLI > ENV > YAML。
  - CLI: `--debug` または `--debug <path>`
  - ENV: `DEBUG=1|true|<path>`
  - YAML: `server.debug: true`。任意で `server.debug_file: <path>` を指定する。
- 単一判定：アプリ起動時に最終状態を一度だけ確定する。enabled/file。以降は共通関数で判定する。`isDebug()`。起動後にモジュール個別で `process.env.DEBUG` を参照しない。
- 出力方針：stderr に出力し、`server.debug_file` 指定時はファイルにも出力する。API キーは出力対象に含めない。
- 出力内容：例。
  - server: `tools/call name=<tool> argsKeys=[...] queryLen=<n>`
  - answer: `profile=<name> model=<id> supports={verbosity:<bool>, reasoning:<bool>}`
  - answer: `request summary tools=web_search(<on/off>) reasoning=<on/off> text.verbosity=<on/off>`
  - openai(client): `error attempt=<n> status=<code> name=<err.name> code=<err.code> msg="..." body="<先頭抜粋>"`
- 機密対策：
  - server ログの query は queryLen のみ記録する。
  - openai client の error body は先頭 300 文字程度を出力する。

### 8.2 エラー詳細の JSON-RPC 返却。DEBUG=1 または `--debug` 時のみ。
- 目的：クライアント UI でサーバ stderr を拾えない場合でも、最小限の切り分け情報を可視化する。
- `tools/call` が失敗した場合、`error` の `data` に以下を含める：
  - `message`。先頭 400 文字程度に丸める。
  - `status`。HTTP ステータスや SDK の `code`。
  - `type`。API エラー種別が得られる場合。
  - `name`。例外名。
- 機密対策：本文・instructions・API キーは含めない。必要最小限のメタ情報のみ。

---

## 9. 多言語・日付規則
- 日本語入力→日本語応答。英語入力→英語応答。
- 相対日付は **Asia/Tokyo** で**絶対日付**化する。今日/昨日/明日。形式は `YYYY-MM-DD`。
- 出典には可能な限り ISO 日付を併記する。公開日が無い場合は **アクセス日** を併記する。

---

## 10. 完了の定義。DoD。
- 「HTTP 404 の意味」は `answer` の JSON で `used_search=false`、`citations=[]` で返る。
- 「本日 YYYY-MM-DD の東京の天気」は `answer` の JSON で `used_search=true`、`citations.length>=1`、`answer`（本文）に **情報源 + ISO 日付** を併記。情報源は URL またはソース識別子。
- `npm run mcp:smoke` が 3 応答を返す。`initialize`。`tools/list`。`tools/call`。`answer`。
- `tools/call` を実行する `scripts/mcp-smoke*.js` は、`child.kill()` まで **4000ms 以上**待機する。強制終了で応答を潰さずに `answer`/`answer_detailed`/`answer_quick` のレスポンス本文を実際に観測できること。

---

## 11. 互換性ポリシー。バージョニング。
- セマンティックバージョニング：
  - 破壊的変更 → **MAJOR**
  - 新機能追加。後方互換。→ **MINOR**
  - バグ修正/依存更新 → **PATCH**
- MCP プロトコル `protocolVersion` は現行 **`2025-06-18`** 固定。`initialize` でのネゴシエーションは行わない。

---

## 12. 参考ファイル。仕様の一部。
- `docs/reference/system-policy.md` — System Policy の参照ガイド
- `docs/reference/config-reference.md` — 設定スキーマと優先順位の詳細
- `config/config.yaml.example` — 設定例（YAML）

---

## 13. 非機能要件（抜粋）
- **安定運用**：npm/Node は安定版の利用を前提とする。
- **再現性**：`--show-config` による実効設定の保存を推奨（`docs/reference/reproducibility.md`）。
- **セキュリティ**：秘密は ENV のみ、ログ最小化。

---

<!-- 公開仕様の本文 -->

## 15. npm 配布メタデータ（package.json 公開仕様）
本セクションは npm 公開時の `package.json` の必須/推奨項目を定義する。公開前には本仕様と一致していることを確認すること。

### 15.1 必須項目
- name: `openai-responses-mcp`
- version: セマンティックバージョニング（現行 `0.9.x`）
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
  "version": "0.9.0",
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
`verbosity` と `reasoning_effort` は tools/call の arguments では指定せず、`model_profiles` の設定値が適用される。
```json
{
  "query": "本日 2025-08-09 の東京の天気は？",
  "recency_days": 60,
  "max_results": 5,
  "domains": ["jma.go.jp","tenki.jp"]
}
```

### A.2 出力（tools/call ← content[0].text）
```json
{
  "answer": "2025-08-09（JST）の東京都の天気は……（略）。\n\nSources:\n- oai-weather (2025-08-09)\n- https://www.jma.go.jp/... (2025-08-09)",
  "used_search": true,
  "citations": [{"url":"oai-weather","title":"api","published_at":"2025-08-09"},{"url":"https://www.jma.go.jp/...","title":"気象庁｜天気予報","published_at":"2025-08-09"}],
  "model": "gpt-5.2"
}
```

---

## 付録 B. エラー例（実装指針）
- ツール実行エラー（共通）：
  ```json
  {"code":-32001,"message":"answer failed","data":{"message":"..."}}
  ```
- ツール実行エラー（DEBUG=1 または `--debug` 時）：
  ```json
  {"code":-32001,"message":"answer failed","data":{"message":"...","status":"...","type":"...","name":"..."}}
  ```
- 未知のツール名：
  ```json
  {"code":-32601,"message":"Unknown tool"}
  ```

## 16. バージョニング / Changelog / Lockfile 運用方針

### 16.1 バージョニング（SemVer）
- バージョンは `package.json` の `version` を参照する。
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

## 17. CI/CD 仕様（GitHub Actions）
本節は GitHub Actions の運用方針を正準仕様としてまとめたもの。実装時は本仕様に完全準拠する。

### 17.1 ブランチ/タグ運用
- `main`: リリース対象ブランチ。
- `feature/*`: 機能開発ブランチ（PR前提）。
- タグ: `vX.Y.Z` 形式のみをリリーストリガに使用（SemVer）。
  - バージョンの決定は手動で `package.json` を bump → `git tag vX.Y.Z` → `git push --tags`。

### 17.2 ワークフロー構成
- `ci.yml`（PR/Push 検証）
  - トリガ: `pull_request`（全ブランチ）/ `push`（全ブランチ）。
  - Node: `20.x`（actions/setup-node@v4）。
  - 手順:
    1) `actions/checkout@v4`
    2) `actions/setup-node@v4`（`node-version: 20`, `cache: npm`）
    3) `npm ci`
    4) `npm run build`
    5) `node scripts/test-tools-list.js`
    6) `node scripts/test-cancel-noinflight.js`
    7) `node scripts/test-cancel-during-call.js`

- `release.yml`（タグ push: 自動リリース — Trusted Publishing を採用）
  - トリガ: `push` with `tags: ["v*"]`
  - 権限: `permissions: { contents: write, id-token: write }`
  - Node: `20.x`、`registry-url: https://registry.npmjs.org/`
  - npm CLI: `npm install -g npm@latest` を実行
  - npm 公開設定（Trusted Publishing / OIDC）:
    - npmjs 側で当該 GitHub リポジトリを Trusted Publishers に登録（初回のみ）
    - Actions 側は `npm publish --provenance --access public` を実行（トークン不要）
  - 公開前に `npm pack --dry-run` で同梱物を確認
  - 任意: GitHub Release ノート生成

### 17.3 シークレット/環境変数
- `OPENAI_API_KEY`（任意・ci.yml）: `node scripts/test-cancel-during-call.js` で使用する。未設定の場合はスクリプト側でスキップする。
- Trusted Publishing では `NPM_TOKEN` は不要。npmjs 側で Trusted Publishers を設定する。

### 17.4 参考 YAML（概要）
以下は実装の骨子（実装時はこの仕様を忠実に反映し、重複や余分な手順は追加しない）。

ci.yml（概要）:
```yaml
name: CI
on:
  push:
  pull_request:
jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - name: Install dependencies
        run: npm ci
      - name: Build
        run: npm run build
      - name: Test (tools/list)
        run: node scripts/test-tools-list.js
      - name: Test (cancel-noinflight)
        run: node scripts/test-cancel-noinflight.js
      - name: Test (cancel-during-call, optional)
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: node scripts/test-cancel-during-call.js
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
          registry-url: https://registry.npmjs.org/
          cache: npm
      - name: Update npm (latest)
        run: npm install -g npm@latest
      - run: npm ci
      - run: npm run build:clean
      - run: npm pack --dry-run
      - run: npm publish --provenance --access public
```

### 17.5 成果物と公開ポリシー
- `package.json.files` に指定された最小セットのみを公開（`build/`, `config/*.example`, `README.md`, `LICENSE`, `package.json`）。
- `prepublishOnly`: `npm run build` を保持（ローカル publish も同一挙動）。
- 公開前に `npm pack --dry-run` で同梱物を確認する。
- 公開後の検証: `npx openai-responses-mcp@latest --stdio` で起動確認。

### 17.6 運用フロー（再掲・確定）
1) feature/* → Pull Request（`ci.yml` 実行）
2) `main` にマージ後、`package.json` を semver で bump
3) `git tag vX.Y.Z && git push --tags`（`release.yml` 実行 → npm publish（Trusted Publishing））
4) Actions の成功確認 → README の npx 例で動作確認
