
# 検証手順（E2E）— openai-responses-mcp

最終更新: 2025-12-19（Asia/Tokyo, AI確認）  
このファイルはローカルでの再現・確認手順を示します。出力は **JSON を機械的に検査**できる形を優先し、`jq` での確認例も併記します。

---

## 0. 前提条件
- Node.js 20 以上（例: v24 系）、npm
- 依存とビルド（再現性重視）:
  ```bash
  npm ci
  npm run build
  ```
- 注意: OpenAI API を実際に呼ぶ検証（任意の一部ステップ）では `OPENAI_API_KEY` が必要です。

---

## 1. サニティチェック（CLI）
### 1-1 版数とヘルプ
```bash
node build/index.js --version
node build/index.js --help
```

### 1-2 実効設定（優先順位: CLI > ENV > YAML > TS）
```bash
# 素の状態
node build/index.js --show-config 2> effective.json; cat effective.json | jq '.version, .sources, .effective.model_profiles.answer.model'
```
**期待**: `sources.ts_defaults=true` が含まれ、`effective.model_profiles.answer.model` が既定（`gpt-5.2`）。

---

## 2. MCP stdio スモーク（LDJSON, API鍵不要）
```bash
npm run mcp:smoke:ldjson | tee /tmp/mcp-smoke-ldjson.out

# initialize と tools/list の応答が JSON 行で出力されること
grep -c '"jsonrpc":"2.0"' /tmp/mcp-smoke-ldjson.out
```
**期待**: `initialize` と `tools/list` の応答が得られる（OpenAI API 呼び出しは行わない）。

### 2-1 追加: ping の確認（API鍵不要・即終了）
```bash
npm run mcp:smoke:ping | tee /tmp/mcp-smoke-ping.out

# ping の result が空オブジェクトで返ること
grep -c '"result":{}' /tmp/mcp-smoke-ping.out
```
**期待**: `initialize` 応答の後に `{"jsonrpc":"2.0","id":<n>,"result":{}}` が出力される。

### 2-2 追加: protocol/capabilities の目視確認
- `protocolVersion` が `2025-06-18` であること
- `initialize` 応答の `capabilities` は `{"tools":{}}` のみ（`roots` は含まれない）

---

## 3. MCP stdio スモーク（Content-Length, 要 OPENAI_API_KEY）
OpenAI API を実際に呼ぶ最小疎通。`scripts/mcp-smoke.js` は `tools/call(answer)` を送るため鍵が必要です。
```bash
export OPENAI_API_KEY="sk-..."
npm run mcp:smoke | tee /tmp/mcp-smoke.out

# initialize → tools/list → tools/call の3応答が Content-Length 付きで流れること
grep -c '^Content-Length:' /tmp/mcp-smoke.out
```

---

## 4. 優先順位の検証（ENV > YAML > TS）
### 4-1 ENV 上書き
```bash
MODEL_ANSWER="gpt-5.2-chat-latest" node build/index.js --show-config 2> effective.json; cat effective.json | jq '.effective.model_profiles.answer.model'
```
**期待**: `"gpt-5.2-chat-latest"`

### 4-2 YAML の読み込み
```bash
cat > /tmp/mcp-config.yaml <<'YAML'
model_profiles:
  answer:
    model: gpt-5.1-codex
    reasoning_effort: high
    verbosity: high
YAML

node build/index.js --show-config --config /tmp/mcp-config.yaml 2> effective.json; cat effective.json | jq '.sources, .effective.model_profiles.answer.model'
```
**期待**: `.sources.yaml` が `/tmp/mcp-config.yaml` を指し、`"gpt-5.1-codex"`。

---

## 5. タイムアウト/リトライ観察（任意, 要 OPENAI_API_KEY）
API 側の都合により再現しづらい場合がありますが、`OPENAI_API_TIMEOUT` を小さくして Abort → リトライを観察できます。
```bash
export OPENAI_API_KEY="sk-..."
OPENAI_API_TIMEOUT=10 npm run mcp:smoke | sed -n '1,120p'
```
（ログにリトライ回数が出る構成にしている場合は、その値を確認してください）

---

## 6. 失敗時の切り分け
- `Missing API key: set OPENAI_API_KEY` → 環境変数未設定
- `ECONNRESET` / `AbortError` → ネットワーク/タイムアウト
- `Unknown tool` → `tools/call` の name ミス（`answer` / `answer_detailed` / `answer_quick` のみ対応）

---

## 7. 成功判定（DoD 準拠）
- 1・2・4 の各検証が**期待どおり**であることに加え、DoD（`docs/spec.md`）の代表ケースが満たされていること。
- 安定知識（例）:
  - 「HTTP 404 の意味」→ `used_search=false`、`citations=[]`
- 時事系（例, 要 `OPENAI_API_KEY`）:
  - 「本日 YYYY-MM-DD の東京の天気」→ `used_search=true`、`citations.length>=1`、本文に `Sources:`（情報源 + ISO日付 `YYYY-MM-DD`）が併記されていること（情報源は URL または `oai-weather` 等の情報源ID）

### 7-1 観測用（簡易）
`answer_quick`（既定）/`answer` を叩いてレスポンス本文を観測します（出力は `scripts/mcp-smoke-apikey.js` が表示）。
```bash
export OPENAI_API_KEY="sk-..."
npm run mcp:quick -- "本日 YYYY-MM-DD の東京の天気"   # answer_quick
npm run mcp:answer -- "本日 YYYY-MM-DD の東京の天気"  # answer
```
**期待**: `[tools/call result]` の JSON（`content[0].text` 内）で、`citations` が 1 件以上になり、`answer` 本文に `Sources:` が含まれる。

---

## 8. キャンセル（notifications/cancelled）の自動テスト

### 8-1 inflightなしのキャンセル（API鍵不要・常時実行）
```bash
npm run build
node scripts/test-cancel-noinflight.js
```
**期待**: `initialize` と `ping` の応答が成功し、テストは exit 0。

### 8-2 実行中キャンセルの抑止（要 OPENAI_API_KEY・任意）
```bash
export OPENAI_API_KEY="sk-..."
npm run build
node scripts/test-cancel-during-call.js
```
**期待**: キャンセル後に `id:3` の `result/error` は出ず、テストは `[test] OK: no response for id=3 after cancel` を表示して exit 0。

備考: GitHub Actions（`ci.yml`）では、APIキー未設定時は 8-2 を自動スキップする。

---

## 9. tools/list のツール定義検証（API鍵不要・常時実行）
```bash
npm run build
node scripts/test-tools-list.js
```
**期待**: `answer` / `answer_detailed` / `answer_quick` の3ツールが含まれる。テストは exit 0。
