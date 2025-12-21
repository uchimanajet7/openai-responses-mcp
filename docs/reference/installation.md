
# インストール手順（ローカル / npm）— `docs/reference/installation.md`
最終更新: 2025-12-20（Asia/Tokyo, AI確認）

本ドキュメントは **openai-responses-mcp** をローカル環境で構築・利用するための**完全な手順**を記載します。  
**npm 固定**（pnpm/yarn は扱いません）。MCP クライアント（Claude）側の登録は別紙 `client-setup-claude.md` を参照。

---

## 1. 前提条件
- OS: macOS / Linux / Windows（PowerShell）
- Node.js: **v20 以上**（推奨: v24 系）
- npm: Node 同梱の安定版
- OpenAI API キー（環境変数で渡す）

> バージョン確認
```bash
node -v
npm -v
```

---

## 2. 最小構成（必須設定のみで起動）
- 必須ENV: `OPENAI_API_KEY`
- 起動（YAML不要）:
```bash
export OPENAI_API_KEY="sk-..."
npx openai-responses-mcp@latest --stdio
```
- 確認: クライアント（Claude）から `initialize` と `tools/list` が返れば疎通OK。

---

## 2. 取得方法
### 2.1 GitHub から ZIP をダウンロードして展開
```
openai-responses-mcp/
  ├─ src/ ...            # TypeScript ソース
  ├─ build/ ...          # ビルド生成物（初回は空）
  ├─ docs/ ...           # ドキュメント
  ├─ config/config.yaml.example
  ├─ package.json
  └─ tsconfig.json
```

> リポジトリ運用は任意。ここでは ZIP 展開を前提とします。

---

## 3. 依存インストールとビルド
```bash
# プロジェクト直下
npm ci
npm run build
```

- 成功すると `build/index.js` が生成されます。
- 以降、CLI は `node build/index.js` または `npx openai-responses-mcp`（npm パッケージとして導入時）で起動可能。

---

## 4. API キーの設定（必須）
- 既定では **`OPENAI_API_KEY`** を参照します（`docs/reference/config-reference.md` 参照）。
- シェル毎に設定方法が異なります。代表例：

**bash/zsh (macOS/Linux)**
```bash
export OPENAI_API_KEY="sk-..."
```

**PowerShell (Windows)**
```powershell
$env:OPENAI_API_KEY="sk-..."
```

> `openai.api_key_env` を YAML で変更した場合は、その ENV 名で設定してください。

---

## 5. 設定ファイル（任意）
YAML は**任意**です。無くても動作します（TS 既定 + ENV/CLI）。

### 5.1 配置場所
- 既定:  
  - macOS/Linux: `~/.config/openai-responses-mcp/config.yaml`  
  - Windows: `%APPDATA%\openai-responses-mcp\config.yaml`
- 明示: `--config /abs/path/config.yaml`

### 5.2 サンプル
```yaml
model_profiles:
  answer:
    model: gpt-5.2
    reasoning_effort: medium
    verbosity: medium

request:
  timeout_ms: 120000
  max_retries: 3
```

> 配列は**置換**、オブジェクトは**深いマージ**。優先順位は **CLI > ENV > YAML > TS**。

---

## 6. 基本コマンド
```bash
# バージョン/ヘルプ
node build/index.js --version
node build/index.js --help

# 実効設定の確認（sources に反映元が出る）
npx openai-responses-mcp --show-config 2> effective.json
npx openai-responses-mcp --show-config --config ./config/config.yaml 2> effective.json
MODEL_ANSWER=gpt-5.2 npx openai-responses-mcp --show-config 2> effective.json
```

期待例（抜粋）:
```json
{
  "version": "0.9.0",
  "sources": { "ts_defaults": true, "yaml": "./config/config.yaml", "env": ["MODEL_ANSWER"], "cli": [] },
  "effective": { "model_profiles": { "answer": { "model": "gpt-5.2", "reasoning_effort": "medium", "verbosity": "medium" } } }
}
```

---

## 7. インストール先の確認（ローカル/グローバル/npx）

### 7.1 ローカル（プロジェクト配下 or tgz 擬似インストール時）
`npm i` や `npm i <tgz>` を実行した直後であれば、カレントの `node_modules` に配置されます。

例（tgz 擬似インストール手順の続き）:
```
echo "$TMP"
ls -la "$TMP/node_modules/openai-responses-mcp"
ls -la "$TMP/node_modules/.bin"
"$TMP/node_modules/.bin/openai-responses-mcp" --show-config 2> effective.json
```

### 7.2 グローバル導入時（任意）
`npm i -g openai-responses-mcp` を実行すると、グローバルの bin ディレクトリに配置されます。通常は `npx` で十分です。

```
npm bin -g
which openai-responses-mcp
```

### 7.3 npx 実行時（キャッシュ）
`npx openai-responses-mcp@latest` は npm のキャッシュ配下に一時取得されて実行されます（パスは内部実装に依存）。
動作の流れは verbose で確認できます。

```
npx -y openai-responses-mcp@latest --version --loglevel=verbose
npm config get cache   # キャッシュディレクトリの場所
```

> 注意: `npx` のキャッシュ場所は環境や npm のバージョンにより異なります。恒久的に場所を固定したい場合は、ローカル（プロジェクト）またはグローバルに通常インストールしてください。

---

## 7. 単体スモーク（MCP プロトコル）
```bash
# LDJSON（API鍵不要）
npm run mcp:smoke:ldjson | tee /tmp/mcp-smoke-ldjson.out
grep -c '"jsonrpc":"2.0"' /tmp/mcp-smoke-ldjson.out

# Content-Length（要 OPENAI_API_KEY）
export OPENAI_API_KEY="sk-..."
npm run mcp:smoke | tee /tmp/mcp-smoke.out
grep -c '^Content-Length:' /tmp/mcp-smoke.out
```

---

## 8. MCP プロトコルのスモークテスト
```bash
npm run mcp:smoke | tee /tmp/mcp-smoke.out
grep -c '^Content-Length:' /tmp/mcp-smoke.out   # 3 以上
```
`initialize → tools/list → tools/call(answer)` の 3 応答が確認できれば、stdio レイヤは健全です。

---

## 9. Claude 側への登録（概要）
- Claude の設定ファイルで `mcpServers` に登録します（**詳細は** `client-setup-claude.md`）。
- 例：
```json
{
  "mcpServers": {
    "openai-responses": {
      "command": "node",
      "args": ["/ABS/PATH/openai-responses-mcp/build/index.js", "--stdio"],
      "env": { "OPENAI_API_KEY": "sk-..." }
    }
  }
}
```

---

## 10. npm パッケージとしての導入（ローカル検証）
リポジトリ直下でパッケージを生成し、**別ディレクトリ**からインストールして `npx` 実行を検証できます。

```bash
# パッケージ生成
npm pack

# 一時ディレクトリで検証
TMP=$(mktemp -d); pushd "$TMP" >/dev/null
npm init -y >/dev/null
npm i "$OLDPWD"/openai-responses-mcp-*.tgz >/dev/null
npx openai-responses-mcp --help
npx openai-responses-mcp --version
popd >/dev/null
```

> 公開前のローカル検証に有効です。正式公開時は `npm publish` を使用。

---

## 11. アンインストール / クリーンアップ
- ローカル依存の削除: `rm -rf node_modules/`（Windows: `rd /s /q node_modules`）
- ビルド生成物の削除: `rm -rf build/`
- npm グローバル導入の削除（任意）: `npm uninstall -g openai-responses-mcp`

---

## 12. トラブルシュート
- **Missing API key**: `OPENAI_API_KEY` 未設定。ENV を見直す。
- **Cannot find module build/index.js**: `npm run build` 未実行または失敗。
- **Content-Length エラー**: バイナリ/改行混入など。再ビルドと `npm run mcp:smoke` を実行。
- **429/5xx が多発**: リトライ上限を上げる（`RETRIES`）。`TIMEOUT` を調整。
- **モデル未対応**: `MODEL_ANSWER` を安定版へ戻す。

---

## 13. セキュリティ注意
- API キーは **ENV でのみ**渡す。YAML/JSON の平文保存は禁止。
- ログに機密を残さない。必要最小のメタ（モデル名・再試行回数・レイテンシ）に留める。
- 共有端末では、作業後に `unset OPENAI_API_KEY`（PowerShell は `$env:OPENAI_API_KEY=$null`）。
