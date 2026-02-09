
# インストール手順（ローカル / npm）— `docs/reference/installation.md`
最終更新: 2026-02-08 Asia/Tokyo

本ドキュメントは **openai-responses-mcp** をローカル環境で構築・利用するための**完全な手順**を記載します。  
**npm 固定**（pnpm/yarn は扱いません）。MCP クライアント（Claude）側の登録は別紙 `client-setup-claude.md` を参照。

---

## 1. 前提条件
- OS: macOS / Linux
- Node.js: **v20 以上**
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
- 起動:
```bash
export OPENAI_API_KEY="sk-..."
npx openai-responses-mcp@latest --stdio
```
- 確認: クライアント（Claude）から `initialize` と `tools/list` が返れば疎通OK。

---

## 3. 取得方法
### 3.1 GitHub から clone して取得
```bash
git clone https://github.com/uchimanajet7/openai-responses-mcp.git
cd openai-responses-mcp
```
```
openai-responses-mcp/
  ├─ src/ ...            # TypeScript ソース
  ├─ docs/ ...           # ドキュメント
  ├─ config/config.yaml.example
  ├─ package.json
  └─ tsconfig.json
```

---

## 4. 依存インストールとビルド
```bash
# プロジェクト直下
npm ci
npm run build
```

- 成功すると `build/index.js` が生成されます。
- 以降、CLI は `node build/index.js` または `npx openai-responses-mcp`（npm パッケージとして導入時）で起動可能。

---

## 5. API キーの設定（必須）
- 既定では **`OPENAI_API_KEY`** を参照します（`docs/reference/config-reference.md` 参照）。
- シェル毎に設定方法が異なります。代表例：

**bash/zsh (macOS/Linux)**
```bash
export OPENAI_API_KEY="sk-..."
```

> `openai.api_key_env` を YAML で変更した場合は、その ENV 名で設定してください。

---

## 6. 設定ファイル
設定ファイルの配置場所は次のとおりです。

### 6.1 配置場所
- 既定: `~/.config/openai-responses-mcp/config.yaml`
- 明示: `--config /abs/path/config.yaml`

### 6.2 サンプル
```yaml
model_profiles:
  answer:
    model: gpt-5.2
    reasoning_effort: medium
    verbosity: medium

request:
  timeout_ms: 300000
  max_retries: 3
```

> 配列は置換し、オブジェクトは深いマージ。優先順位は ENV > YAML > TS defaults。

---

## 7. 基本コマンド
```bash
# バージョン/ヘルプ
node build/index.js --version
node build/index.js --help

# 実効設定の確認（sources に反映元が出る。stderr に JSON 出力）
node build/index.js --show-config 2> effective.json

# デバッグログをファイルへ出力
node build/index.js --stdio --debug ./_debug.log

# YAML を使う場合（利用者が用意した設定ファイルを指定）
# - 例: ./config/config.yaml を作成する場合は `config/config.yaml.example` をコピーして編集する
node build/index.js --show-config --config ./config/config.yaml 2> effective.json

# ENV による一時上書き（例: MODEL_ANSWER）
MODEL_ANSWER=gpt-5.2-chat-latest node build/index.js --show-config 2> effective.json
```

期待例（抜粋、`MODEL_ANSWER` を設定した場合）:
```json
{
  "version": "0.10.1",
  "sources": { "ts_defaults": true, "env": ["MODEL_ANSWER"], "cli": [] },
  "effective": { "model_profiles": { "answer": { "model": "gpt-5.2-chat-latest", "reasoning_effort": "medium", "verbosity": "medium" } } }
}
```

---

## 8. インストール先の確認（ローカル/グローバル）

### 8.1 ローカル（プロジェクト配下 or tgz 擬似インストール時）
`npm i` や `npm i <tgz>` を実行した直後であれば、カレントの `node_modules` に配置されます。

例（tgz 擬似インストール手順の続き）:
```
ls -la node_modules/openai-responses-mcp
ls -la node_modules/.bin
./node_modules/.bin/openai-responses-mcp --show-config 2> effective.json
```

### 8.2 グローバル導入時
`npm i -g openai-responses-mcp` を実行すると、グローバルの bin ディレクトリに配置されます。通常は `npx` で十分です。

```
npm bin -g
which openai-responses-mcp
```

---

## 9. 単体スモーク（MCP プロトコル）
```bash
# LDJSON
npm run mcp:smoke:ldjson | tee ./mcp-smoke-ldjson.out
grep -c '"jsonrpc":"2.0"' ./mcp-smoke-ldjson.out

# Content-Length（要 OPENAI_API_KEY）
export OPENAI_API_KEY="sk-..."
npm run mcp:smoke | tee ./mcp-smoke.out
grep -c '^Content-Length:' ./mcp-smoke.out   # 3 以上
```
`initialize → tools/list → tools/call(answer)` の 3 応答が確認できれば、stdio レイヤは健全です。

---
## 10. Claude Code への登録（概要）
- `~/.claude.json` の `mcpServers` に登録します。詳細は `client-setup-claude.md` を参照。
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

## 11. npm パッケージとしての導入（ローカル検証）
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

> 公開前のローカル検証に有効です。正式公開は `git tag vX.Y.Z && git push --tags` で `release.yml` が実行される。

---

## 12. アンインストール / クリーンアップ
- ローカル依存の削除: `rm -rf node_modules/`
- ビルド生成物の削除: `rm -rf build/`
- npm グローバル導入をしている場合の削除: `npm uninstall -g openai-responses-mcp`

---

## 13. トラブルシュート
- **Missing API key**: `OPENAI_API_KEY` 未設定。ENV を見直す。
- **Cannot find module build/index.js**: `npm run build` 未実行または失敗。
- **Content-Length エラー**: バイナリ/改行混入など。再ビルドと `npm run mcp:smoke` を実行。
- **429/5xx が多発**: リトライ上限は `OPENAI_MAX_RETRIES`（または `request.max_retries`）を上げる。`OPENAI_API_TIMEOUT`（または `request.timeout_ms`）を調整。
- **モデルの互換性エラー**: `MODEL_ANSWER` を `model_profiles.answer.model` で指定する安定版へ戻す。

---

## 14. セキュリティ注意
- API キーは **ENV でのみ**渡す。YAML/JSON の平文保存は禁止。
- ログは通常は最小限。デバッグ有効時は送受信 JSON が出力されるため回答本文が含まれる。
- 共有端末では、作業後に `unset OPENAI_API_KEY`。
