
# 正準仕様。Canonical Spec。 `docs/spec.md`
最終更新: 2026-09-07 Asia/Tokyo

バージョン: **v1.2.2**

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
  - `ping`：ヘルスチェック用。空オブジェクトで成功応答。

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

{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{\"answer\":\"...\",\"used_search\":false,\"citations\":[],\"model\":\"gpt-5.6-sol\"}"}]}}
```

### 2.6 ping
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
    model: gpt-5.6-terra
    reasoning_effort: medium
    verbosity: medium
  answer_detailed:  # オプション。省略時は answer で代替。
    model: gpt-5.6-sol
    reasoning_effort: high
    verbosity: high
  # answer_quick は省略 → answer の設定で動作
```

**最小設定**：
```yaml
model_profiles:
  answer:  # 必須のみ設定
    model: gpt-5.6-sol
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
  "model": "actual model id returned by the API. Example: gpt-5.6-sol"
}
```
- `model` は Responses API の `response.model` を返す。要求時に `gpt-5.6` のようなエイリアスを指定した場合も、実際に処理したモデルを記録する。API 応答に `model` が無い場合だけ、要求したモデルIDをフォールバックとして返す。
- **answer（本文）側の順序規約**：answer（本文）→ 必要に応じて箇条書き → web_search を使い `citations` が 1 件以上ある場合は `Sources:` で **情報源 + ISO 日付**を併記。`citations` が空のときは `Sources:` を付与しない。
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
- `--config <path>` を指定した場合はそのファイルを読む。指定しない場合は上記の既定パスを読む。

### 5.3 代表スキーマ
```yaml
openai:
  api_key_env: OPENAI_API_KEY
  base_url: https://api.openai.com/v1

request: { timeout_ms: 300000, max_retries: 3 }

model_profiles:
  answer:           # 必須・基準プロファイル
    model: gpt-5.6-terra
    reasoning_effort: medium
    verbosity: medium
    
  answer_detailed:  # オプション・詳細分析用
    model: gpt-5.6-sol
    reasoning_effort: high
    verbosity: high
    
  answer_quick:     # オプション・高速回答用
    model: gpt-5.6-luna
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
- TS 既定値は `gpt-5.6-sol` / `medium` / `medium` とする。これは既存の単一プロファイル構成を、GPT-5.6 系の最上位・汎用モデルへ移行しつつ既存の推論強度を維持するためである。
- GPT-5.6 系の用途別モデルは、最高性能の `gpt-5.6-sol`、知能・速度・コストの均衡を重視する `gpt-5.6-terra`、高スループット・低コスト向けの `gpt-5.6-luna` とする。`gpt-5.6` は `gpt-5.6-sol` を指すエイリアスだが、再現性と観測可能性のため設定例では明示的なモデルIDを使う。
- `verbosity` の適用: モデルIDの接頭辞が `gpt-5` のときのみ適用する。
- `reasoning_effort` は `gpt-5` / `o3` / `o4` 系モデルでのみ有効。その他のモデルでは OpenAI Responses API の検証結果に従う（エラーとなる場合がある）。
- `reasoning_effort` の設定可能値: `none` / `low` / `medium` / `high` / `xhigh` / `max`。既定は `medium`。この全範囲は GPT-5.6 系で利用できる。モデルごとの対応差は Responses API の検証結果に従う。
- GPT-5.6 の Pro はモデルIDではなく `reasoning.mode: "pro"` で指定する別の実行モードである。v1.2.2 では設定契約に Pro mode を追加せず、従来どおり `reasoning.effort` のみを送信する。したがって `gpt-5.6-pro` というモデルIDは使用しない。
- 互換性エラーを避けるため、対応モデルIDのみを指定する。
- マルチプロファイルの継承: `answer_detailed`/`answer_quick` が未定義の場合、`answer` の設定を継承して動作する。

根拠となる公式仕様:
- [GPT-5.6 migration guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.6#migrate-to-gpt-56)
- [GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol) / [GPT-5.6 Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra) / [GPT-5.6 Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)

---

## 6. 実行フロー。マルチプロファイル対応。
1. **ツール判定**：MCPクライアントが`answer`/`answer_detailed`/`answer_quick`から選択。
2. **プロファイル決定**：選択されたツール名に対応する`model_profiles`設定を取得する。未定義なら`answer`の設定を使う。
3. **入力検証**: 入力は上流で検証する前提とし、サーバ側では追加の検証を行わない。
4. **Responses 呼び出し。試行。**：
   - `model`: プロファイルの`model`値。例: `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`.
   - `instructions`: System Policy。4章に従い `src/policy/system-policy.ts` の `SYSTEM_POLICY` を用いる。
- `input`: ユーザ `query` に `recency_days` と `max_results` のヒントを常に付与する。`domains` は入力で指定がある場合はそれを使用する。指定が無い場合は設定の `search.defaults.domains` を使用する。`search.defaults.domains` が空配列の場合は付与しない。
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
   - `model` には Responses API の `response.model` を用いる。API 応答に値が無い場合のみ、要求したモデルIDへフォールバックする。
   - `used_search=true` かつ `citations` が 1 件以上のときは `answer` の本文末尾に `Sources:` を付与し、情報源 + ISO日付を併記する。付与の担保はサーバ側の責務とし、3.2 の出力契約を満たす。`citations` が空のときは付与しない。
8. **返送**：MCP レスポンスの `content[0].text` に **JSON 文字列**として格納。

---

### 6.1 キャンセル。MCP notifications/cancelled。

本サーバーは MCP のキャンセル通知に対応する。

- クライアント通知。片方向。
  - `method`: `notifications/cancelled`
  - `params`: `{ requestId: string | number, reason?: string }`
  - 通知なので応答しない。

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
  - YAML: `server.debug: true` / `server.debug_file: <path>`。
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
- GPT-5.6 回帰テストで、既定値 `gpt-5.6-sol`、3つの明示モデルID、`none` から `max` までの推論強度、エイリアス指定時の実モデル記録を自動検証する。
- 「HTTP 404 の意味」は `answer` の JSON で `used_search=false`、`citations=[]` で返る。
- 「本日 YYYY-MM-DD の東京の天気」は `answer` の JSON で `used_search=true`、`citations.length>=1`、`answer`（本文）に **情報源 + ISO 日付** を併記。情報源は URL またはソース識別子。
- `npm run mcp:smoke` が 3 応答を返す。`initialize`。`tools/list`。`tools/call`。`answer`。
- `tools/call` を実行する `scripts/mcp-smoke*.js` は、`child.kill()` まで **4000ms 以上**待機する。強制終了で応答を潰さずに `answer`/`answer_detailed`/`answer_quick` のレスポンス本文を実際に観測できること。

---

## 11. 互換性ポリシー。バージョニング。
- 採番の判断基準と版情報の管理は [16.1 バージョニング](#161-バージョニングsemver) に従う。
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
- version: [16.1 バージョニング](#161-バージョニングsemver) に従って決定した `package.json` の版
- description: 以下の文言を使用（段階表現「Step N:」は含めない）
  - `Lightweight MCP server (Responses API core). OpenAI integration + web_search.`
- type: `module`
- bin: `{ "openai-responses-mcp": "build/index.js" }`
- files: `["build","config/config.yaml.example","config/policy.md.example","README.md","LICENSE"]`
- scripts.prepublishOnly: `npm run build:clean`
- engines.node: `>=24 <25`
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
  "version": "1.2.2",
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
  "scripts": { "prepublishOnly": "npm run build:clean" },
  "engines": { "node": ">=24 <25" },
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/uchimanajet7/openai-responses-mcp.git" },
  "homepage": "https://github.com/uchimanajet7/openai-responses-mcp#readme",
  "bugs": { "url": "https://github.com/uchimanajet7/openai-responses-mcp/issues" }
}
```

### 15.4 適用・検証フロー
1) 仕様との差分を洗い出す（`description` に「Step N:」が残っていないか確認）。
2) `repository/homepage/bugs` を本仕様のURLで追加。
3) `npm run build:clean` を実行し、続けて `npm pack --dry-run` で同梱物とメタを確認。
4) [16.2 Changelog](#162-changelog) に従い、リリース確定時に変更理由と影響範囲を記録する。

注記：本仕様は公開メタデータの最低限を定めるものであり、依存やスクリプトの詳細は上位セクション（機能仕様）に従う。

---

## 付録 A. `answer` の I/O 例
### A.1 入力（tools/call → arguments）
`verbosity` と `reasoning_effort` は tools/call の arguments では指定せず、`model_profiles` の設定値が適用される。`recency_days` / `max_results` / `domains` は arguments で指定できる。
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
  "model": "gpt-5.6-sol"
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
- 本プロダクトの採番基準は本節に集約する。変更の実体を [変更履歴](./changelog.md) の同種の事例と比較し、利用者に提供する機能と互換性への影響で判定する。

| 区分 | 判断基準 |
|---|---|
| MAJOR | 既存の利用方法を壊す機能・API・設定契約・実行要件の変更。 |
| MINOR | 後方互換の機能追加・拡張。MCPツールや設定機能の追加、既定モデルの更新など。 |
| PATCH | 公開機能の追加や非互換変更を伴わない不具合修正・依存更新・導入やビルド、CI、依存管理の保守改善。 |

- 複数の区分に該当する変更を含む場合は、影響が最も大きい区分を採用する。影響が未確認なら調査してから採番する。
- 文書や System Policy の改訂は、実際の機能・挙動と互換性への影響を上表で分類する。文書を編集したことや保守作業の量だけで MINOR に上げない。ソース導入・開発環境の要件は、配布パッケージの実行要件と区別して評価する。
- 採番はメンテナが確定し、`package.json` の `version` を管理元とする。現行版を記した文書と期待例も同じ版に揃える。過去のリリース履歴の版は書き換えない。
- 版の反映には `npm version X.Y.Z --no-git-tag-version` を使用し、`package.json` と `package-lock.json` を npm で同期する。`package-lock.json` の `version` は**手動で書き換えない**。コミット・タグ・公開は [17.1](#171-ブランチタグ運用) の別操作として扱う。
- Node は `engines.node: ">=24 <25"` を満たすこと。

根拠: [SemVer 2.0.0](https://semver.org/spec/v2.0.0.html)、[npm version](https://docs.npmjs.com/cli/v11/commands/npm-version/)。SemVer が許容する内部改善による MINOR 更新を、本プロダクトの保守修正に一律適用しない。

### 16.2 Changelog
- 位置: [docs/changelog.md](./changelog.md)。採番と記載内容を決める前に、過去の同種変更の分類・粒度・説明を参照する。
- 形式: 既存の `## [X.Y.Z] - YYYY-MM-DD` と「分類: 具体的な変更と結果」の箇条書きを使用し、最新リリースから並べる。`Unreleased` セクションは使用しない。
- 記載対象: 利用者やメンテナに意味のある機能・設定・依存・導入・保守上の変更。依存更新は変更前後の版、修正は対象と改善結果を簡潔に示す。テスト・CI・文書も運用に意味のある変更を記載し、変更ファイルの羅列や軽微な内部整理は載せない。
- リリース確定時に、メンテナが確定した版と Asia/Tokyo の日付で新セクションを先頭に追加する。採番理由が分かる変更内容を記し、過去のリリースに記載済みの変更を重複掲載しない。
- 根拠: [Keep a Changelog](https://keepachangelog.com/en/2.0.0/) の「利用者にとって意味のある変更を選んで記録する」という原則を参照する。具体的な書式とリリース時の運用は本節に従う。

### 16.3 Lockfile / 依存関係 / クリーンビルド運用（npm lockfile v3）
- `package-lock.json` は**VCS にコミット**する（再現性のため）。
- 通常の依存導入は **`package-lock.json` をソース** とし、`npm ci` で再現する。
- `package-lock.json` は手動編集禁止。依存更新は `npm run deps:update` に集約し、npm に生成させる。
- 開発・CI は npm 11.19.0 以上を使用し、`devEngines.packageManager` で要件を検査する。これはソースを扱う環境の要件であり、配布パッケージ利用者向けの `engines.npm` は追加しない。
- `.npmrc` の `omit-lockfile-registry-resolved=true` を保持する。レジストリ URL を lockfile に固定しない既存の導入・配布方針を維持する。
- 導入時スクリプトは `package.json` の `allowScripts` で管理する。`esbuild` / `fsevents` は名前単位で許可し、同じパッケージの更新ごとに承認を追加しない。これは当該パッケージの将来バージョンにも実行を許可する判断である。
- `.npmrc` の `strict-allow-scripts=true` により、新しい未承認スクリプトは実行前に停止する。更新スクリプトは承認を自動追加せず、`DEPS_UPDATE_YES` も承認範囲を広げない。
- ビルド手順は実行場所ではなく、環境状態で分ける。
  - 新規の環境: チェックアウト後に `npm ci` で依存関係を作成し、`npm run build` でビルドする。GitHub Actions の `ci.yml` はこの具体例である。
  - 既存の開発環境: 既存の `build/` と `node_modules` の状態に依存しないため、`npm run build:fresh` で生成物削除、依存再導入、ビルドを実行する。
  - 既存の開発環境でビルド生成物だけを作り直す場合: `npm run build:clean` を使用する。
- `clean` 系スクリプトは対象を分ける。
  - `clean`: `clean:build` の別名。
  - `clean:build`: `build/` などのビルド生成物だけを削除する。
  - `deps:install`: `npm ci` により `node_modules` を `package-lock.json` から作り直す。
  - `deps:check`: 導入済み依存の更新候補を `npm outdated --all` で調べ、直接依存の latest と間接依存の wanted（親依存の制約内）を表示する。制約外の間接依存の latest は参考情報として区別する。lockfile 全体の `npm audit` と `npm install-scripts ls` による承認漏れも確認し、プロジェクトのファイルは変更しない。事前に `npm run deps:install` で開発依存を含めて導入する。
  - `deps:update`: 確認後、直接依存の指定を latest へ更新（メジャー更新を含み、既存の `^` / `~` を保持）し、パッケージ名を指定しない `npm update` で間接依存も親依存の制約内で更新する。直接依存の変更がない場合も依存全体を再解決する。個別パッケージの固定や `npm audit fix --force` による制約の上書きは行わない。
  - `build`: 現在の依存状態で TypeScript をビルドする。
  - `build:clean`: `clean:build` の後に `build` を実行する。
  - `build:fresh`: 既存の開発環境で `clean:build`、`deps:install`、`build` の順に実行し、新規の環境での依存導入とビルドに近い状態を作る。
- 最新版を使うことと、lockfile どおりに再現することは別の操作である。
  - 最新確認: `npm run deps:check`
  - 最新更新: `npm run deps:update`
  - lockfile 再現: `npm run deps:install`
  - 生成物と依存関係を作り直すビルド: `npm run build:fresh`
- CI/配布: lockfile v3 を前提（Node 24.x を前提。GitHub Actions は CI / 配布ともに Node 24.x を使用）。
- 更新前後の監査は開発・optional・peer 依存を含め、全重大度を表示する。High / Critical が残る場合は失敗扱いとし、Low / Moderate は内容と適用条件をメンテナが判断する。通信失敗・不正な JSON は「問題なし」と扱わない。
- `deps:check` の終了コード: 0=更新候補・脆弱性・未承認スクリプトなし、1=確認事項あり、2=実行エラー。親の制約外の最新版という参考情報だけでは 1 にしない。
- 別 OS 向けバイナリや利用していない optional peer など、未導入の optional 依存は更新候補に数えない。lockfile に記録された依存の脆弱性は引き続き全体監査の対象とする。
- `deps:update` の終了コード: 0=依存更新と監査が完了し High / Critical なし、1=更新を中止、2=実行エラーまたは未承認スクリプト、3=更新後も High / Critical が残存。Low / Moderate の残存も明示する。途中失敗時は変更済みの可能性があるファイルを案内し、自動で巻き戻さない。
- ビルド・テストは更新処理と分離する。更新後は `build:fresh`、`test:deps`、既存の API 通信なしのテスト、`npm run dev -- --help` で再現性と開発用変換処理を確認する。OpenAI API を実際に呼ぶ検証は別途実施する。
- 根拠: [npm update](https://docs.npmjs.com/cli/v11/commands/npm-update/)、[npm audit](https://docs.npmjs.com/cli/v11/commands/npm-audit/)、[install-script policy](https://docs.npmjs.com/cli/v11/using-npm/config/#strict-allow-scripts)、[devEngines](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#devengines)。

以上。

---

## 17. CI/CD 仕様（GitHub Actions）
本節は GitHub Actions の運用方針を正準仕様としてまとめたもの。実装時は本仕様に完全準拠する。

### 17.1 ブランチ/タグ運用
- `main`: リリース対象ブランチ。
- `feature/*`: 機能開発ブランチ（PR前提）。
- タグ: `vX.Y.Z` 形式のみをリリーストリガに使用（SemVer）。
  - メンテナが [16.1](#161-バージョニングsemver) に従って採番を確定し、版情報と [変更履歴](#162-changelog) を揃える。
  - レビュー・コミット後、メンテナが公開するコミットに `git tag vX.Y.Z` を付けて `git push --tags` を実行する。版情報の修正だけで公開を実行しない。

### 17.2 ワークフロー構成
- `ci.yml`（PR/Push 検証）
  - トリガ: `pull_request`（全ブランチ）/ `push`（全ブランチ）。
  - Node: `24.x`（actions/setup-node@v7）。npm は配布ワークフローと同様に `npm@latest` へ更新する。
  - 手順:
    1) `actions/checkout@v7`
    2) `actions/setup-node@v7`（`node-version: 24`, `cache: npm`）
    3) `npm install -g npm@latest`
    4) `npm ci`
    5) `npm audit --package-lock-only --include=dev --include=optional --include=peer --audit-level=high`
    6) `npm run test:deps`
    7) `npm run build`
    8) `npm run dev -- --help`
    9) `node scripts/test-gpt56-support.js`
    10) `node scripts/test-tools-list.js`
    11) `node scripts/test-cancel-noinflight.js`
    12) `node scripts/test-cancel-during-call.js`

- `release.yml`（タグ push: 自動リリース — Trusted Publishing を採用）
  - トリガ: `push` with `tags: ["v*"]`
  - 権限: `permissions: { contents: write, id-token: write }`
  - Node: `24.x`、`registry-url: https://registry.npmjs.org/`
  - npm CLI: `npm install -g npm@latest` を実行
  - `npm ci` 後、CI と同じ `npm audit --package-lock-only --include=dev --include=optional --include=peer --audit-level=high` を実行し、High / Critical または監査失敗で公開を止める。
  - npm 公開設定（Trusted Publishing / OIDC）:
    - npmjs 側で当該 GitHub リポジトリを Trusted Publishers に登録（初回のみ）
    - Actions 側は `npm publish --provenance --access public` を実行
  - 公開前に `npm pack --dry-run` で同梱物を確認
  - GitHub Release ノート生成

- `dependabot.yml`（週次依存更新）
  - 配置: `.github/dependabot.yml`
  - 対象 ecosystem: `github-actions` / `npm`
  - 対象 directory: `/`
  - スケジュール: `weekly`。`monday` の `09:00`、`Asia/Tokyo`
  - 目的: GitHub Actions と npm 依存の更新を定期検知する。脆弱性に対する security updates の有効化は GitHub リポジトリ設定で別途管理する。

### 17.3 シークレット/環境変数
- `OPENAI_API_KEY`（ci.yml）: `node scripts/test-cancel-during-call.js` で使用する。未設定の場合はスクリプト側でスキップする。
- Trusted Publishing を使う場合は npmjs 側で Trusted Publishers を設定する。

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
        uses: actions/checkout@v7
      - name: Setup Node.js
        uses: actions/setup-node@v7
        with:
          node-version: 24
          cache: 'npm'
      - name: Update npm (latest)
        run: npm install -g npm@latest
      - name: Install dependencies
        run: npm ci
      - name: Audit dependencies
        run: npm audit --package-lock-only --include=dev --include=optional --include=peer --audit-level=high
      - name: Test (dependency maintenance)
        run: npm run test:deps
      - name: Build
        run: npm run build
      - name: Test (development entry point)
        run: npm run dev -- --help
      - name: Test (GPT-5.6 support)
        run: node scripts/test-gpt56-support.js
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
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
          registry-url: https://registry.npmjs.org/
          cache: npm
      - name: Update npm (latest)
        run: npm install -g npm@latest
      - run: npm ci
      - run: npm audit --package-lock-only --include=dev --include=optional --include=peer --audit-level=high
      - run: npm run build:clean
      - run: npm pack --dry-run
      - run: npm publish --provenance --access public
```

### 17.5 成果物と公開ポリシー
- `package.json.files` に指定された最小セットのみを公開（`build/`, `config/*.example`, `README.md`, `LICENSE`, `package.json`）。
- `prepublishOnly`: `npm run build:clean` を保持（ローカル publish も同一挙動）。
- 公開前に `npm pack --dry-run` で同梱物を確認する。
- 公開後の検証: `npx openai-responses-mcp@latest --stdio` で起動確認。

### 17.6 運用フロー（再掲・確定）
1) feature/* → Pull Request（`ci.yml` 実行）
2) `main` にマージ後、`package.json` を semver で bump
3) `git tag vX.Y.Z && git push --tags`（`release.yml` 実行 → npm publish（Trusted Publishing））
4) Actions の成功確認 → README の npx 例で動作確認
