
# 検証手順（E2E）— openai-responses-mcp

最終更新: 2026-09-09 Asia/Tokyo

このファイルはローカルでの再現・確認手順を示します。出力は **JSON を機械的に検査**できる形を優先し、`jq` での確認例も併記します。

---

## 0. 前提条件
- Node.js 24 以上、npm 11.19.0 以上。CI / Release は Node.js 24 系で実行する（詳細は [再現性・再構築ガイド](reference/reproducibility.md#2-強制するバージョン固定)）。
- jq（JSON 解析の確認で使用）
- 新規の環境での依存とビルド:
  ```bash
  npm ci
  npm run build
  ```
- 既存の開発環境で依存関係とビルド生成物を作り直す場合は `npm run build:fresh` を実行する。
- 注意: OpenAI API を実際に呼ぶ検証では `OPENAI_API_KEY` が必要です。

---

## 1. サニティチェック（CLI）
### 1-1 版数とヘルプ
```bash
node build/index.js --version
node build/index.js --help
```

### 1-2 実効設定: 設定値の優先順位は ENV > YAML > TS defaults
```bash
# 素の状態
node build/index.js --show-config 2> effective.json; cat effective.json | jq '.version, .sources, .effective.model_profiles.answer.model'
```
**期待**: `sources.ts_defaults=true` が含まれ、`effective.model_profiles.answer.model` が既定（`gpt-6-astra`）。

### 1-3 モデル設定・送信回帰テスト（API 呼び出しなし）
```bash
npm run test:models
```
**期待**: `[test] model-support: OK`。Astra の既定値、全3ツールへのプロファイル適用、YAML / ENV によるモデル指定、推論強度・詳しさの送信と非対応モデルへの非送信、API実モデルIDの記録を検査する。設定の許可値と Astra の対応値は分けて扱う。HTTP 通信を置き換えた検証であり、実APIの成功を示すものではない。

### 1-4 依存更新後の検証（API 呼び出しなし）
```bash
npm run build:fresh
npm run test:deps
npm run test:models
npm run test:tools-list
npm run test:cancel-noinflight
npm run dev -- --help
npm run deps:check
```

**期待**: lockfile からの再導入と TypeScript ビルド、依存更新フローの回帰テスト、既存の MCP テスト、`tsx` による開発起動が成功する。`deps:check` は更新候補、全重大度の脆弱性、未承認スクリプトを報告する（終了コード 1 は確認事項あり、2 は確認自体の失敗）。新しい依存に更新候補や脆弱性が見つかった場合は、その内容を判断し、無条件に警告を非表示にしない。

`test:deps` は npm 応答を制御したテストに加え、ローカルの fixture を使って実際の npm が未承認スクリプトを実行前に停止することをネットワークなしで検証する。fixture は `_local/_ai-agent/tmp/` 内に作成し、終了時に削除する。

CI / タグ配布の監査基準だけを確認する場合:
```bash
npm audit --package-lock-only --include=dev --include=optional --include=peer --audit-level=high
```
**期待**: High / Critical または通信等の監査エラーで失敗し、Low / Moderate のみなら表示を残して成功する。これは自動停止の基準であり、脆弱性がゼロであることと同義ではない。

---

## 2. MCP stdio スモーク（LDJSON）
```bash
npm run mcp:smoke:ldjson | tee ./mcp-smoke-ldjson.out

# initialize と tools/list の応答が JSON 行で出力されること
grep -c '"jsonrpc":"2.0"' ./mcp-smoke-ldjson.out
```
**期待**: `initialize` と `tools/list` の応答が得られる（OpenAI API 呼び出しは行わない）。

### 2-1 追加: ping の確認
```bash
npm run mcp:smoke:ping | tee ./mcp-smoke-ping.out

# ping の result が空オブジェクトで返ること
grep -c '"result":{}' ./mcp-smoke-ping.out
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
npm run mcp:smoke | tee ./mcp-smoke.out

# initialize → tools/list → tools/call の3応答が Content-Length 付きで流れること
grep -c '^Content-Length:' ./mcp-smoke.out
```

---

## 4. 優先順位の検証: ENV > YAML > TS defaults
既定値との差が分かるよう、ここでは利用者指定モデルに `gpt-4.1` を使用する。

### 4-1 ENV 上書き
```bash
MODEL_ANSWER="gpt-4.1" node build/index.js --show-config 2> effective.json; cat effective.json | jq '.effective.model_profiles.answer.model'
```
**期待**: `"gpt-4.1"`

### 4-2 YAML の読み込み
```bash
cat > ./mcp-config.yaml <<'YAML'
model_profiles:
  answer:
    model: gpt-4.1
YAML

node build/index.js --show-config --config ./mcp-config.yaml 2> effective.json; cat effective.json | jq '.sources, .effective.model_profiles.answer.model'
```
**期待**: `.sources.yaml` が `./mcp-config.yaml` を指し、`"gpt-4.1"`。

---

## 5. タイムアウト観察（要 OPENAI_API_KEY）
API 側の都合により再現しづらい場合がありますが、`OPENAI_API_TIMEOUT` を小さくしてタイムアウト（AbortError）を観察できます（タイムアウト時は再試行せず中断）。
```bash
export OPENAI_API_KEY="sk-..."
OPENAI_API_TIMEOUT=10 npm run mcp:smoke | sed -n '1,120p'
```
（429/5xx の場合のみ、再試行が発生します）

---

## 6. 失敗時の切り分け
- `Missing API key: set OPENAI_API_KEY` → 環境変数未設定
- `ECONNRESET` / `AbortError` → ネットワーク/タイムアウト
- `Unknown tool` → `tools/call` の name ミス（`answer` / `answer_detailed` / `answer_quick` のみ対応）

---

## 7. 成功判定（DoD 準拠）
- 1・2・4 の各検証が**期待どおり**であることに加え、DoD（`docs/spec.md`）の代表ケースが満たされていること。
- 安定知識（例）:
  - 「HTTP 404 の意味」→ `answer` の JSON で `used_search=false`、`citations=[]`
- 時事系（例, 要 `OPENAI_API_KEY`）:
  - 「本日 YYYY-MM-DD の東京の天気」→ `answer` の JSON で `used_search=true`、`citations.length>=1`、本文に `Sources:`（情報源 + ISO日付 `YYYY-MM-DD`）が併記されていること（情報源は URL または `oai-weather` 等の情報源ID）

### 7-1 実際に質問して回答を確認する
ビルド済みのプロジェクト直下で、既存のスクリプトを実行する。API キーを設定済みなら再登録や設定ファイルの作成は不要。次の質問は実際に OpenAI API を呼び出し、利用料金が発生する。

```bash
npm run mcp:answer -- "HTTP 404 の意味を説明してください"
```

`[tools/call result]` の `content[0].text` 内で、`answer` に質問への回答、`model` に実際に使用したモデルが表示されることを確認する。モデル未指定なら Astra が使われる。YAML / ENV に明示したモデルがある場合は、その指定が優先される。

検索付き回答と他ツールの確認は、次の既存コマンドを使う。`YYYY-MM-DD` は実行日の Asia/Tokyo の日付に置き換える。

```bash
export OPENAI_API_KEY="sk-..."
npm run mcp:quick -- "本日 YYYY-MM-DD の東京の天気"   # answer_quick
npm run mcp:answer -- "本日 YYYY-MM-DD の東京の天気"  # answer
node scripts/mcp-smoke-apikey.js --tool answer_detailed "HTTP 404 の意味を説明してください"
```
**期待**: 天気の回答は `used_search=true`、`citations` が1件以上で、本文に情報源とISO日付が含まれる。HTTP 404 の回答は `used_search=false`、`citations=[]`。エラーや30秒の応答待ちタイムアウトは成功と扱わず、終了コードだけで判断しない。

---

## 8. キャンセル（notifications/cancelled）の自動テスト

### 8-1 inflightなしのキャンセル
```bash
npm run build:clean
node scripts/test-cancel-noinflight.js
```
**期待**: `initialize` と `ping` の応答が成功し、テストは exit 0。

### 8-2 実行中キャンセルの抑止（要 OPENAI_API_KEY）
```bash
export OPENAI_API_KEY="sk-..."
npm run build:clean
node scripts/test-cancel-during-call.js
```
**期待**: キャンセル後に `id:3` の `result/error` は出ず、テストは `[test] OK: no response for id=3 after cancel` を表示して exit 0。

備考: GitHub Actions（`ci.yml`）では、APIキー未設定時は 8-2 を自動スキップする。

---

## 9. tools/list のツール定義検証
```bash
npm run build:clean
node scripts/test-tools-list.js
```
**期待**: `answer` / `answer_detailed` / `answer_quick` の3ツールが含まれる。テストは exit 0。
