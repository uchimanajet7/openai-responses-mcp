
# 環境セットアップ（ローカル開発・再現性）— `docs/reference/environment-setup.md`
最終更新: 2026-01-14 Asia/Tokyo

本ドキュメントは **openai-responses-mcp** をローカルで安定稼働させるための環境準備を、OS 別に具体化した手順です。  
**npm 固定**。beta/alpha ツールは使いません。

---

## 1. 要件
- OS: macOS / Linux
- Node.js: **v20 以上（推奨: v24 系）**
- npm: Node 同梱の安定版
- ネットワーク: `api.openai.com` への HTTPS アクセス
- OpenAI API キーを **環境変数**で渡す（YAML に秘密は入れない）

> 確認:
```bash
node -v
npm -v
```

---

## 2. Node.js の導入（代表パターン）
- 既に Node が入っている場合はこの節をスキップ。  
- 管理者権限が不要なユーザ領域インストールを推奨。

### 2.1 macOS
- 公式インストーラ（.pkg）または Homebrew（`brew install node@20` 等）。  
- PATH に `node` / `npm` が入っていることを確認。

### 2.2 Linux
- ディストリに付属の安定版（apt/dnf 等）または公式バイナリ。  
- ビルドが必要な場合に備えて `build-essential` 相当を導入。

> いずれの OS でも `node -v` がエラー無く表示されれば OK。

---

## 3. シェル環境に API キーを設定
**必須**。セキュアに扱う。YAML/JSON へ直接書かない。

### 3.1 一時的（現在のターミナルのみ）
**bash/zsh (macOS/Linux)**
```bash
export OPENAI_API_KEY="sk-..."
```

### 3.2 永続化（次回以降も有効）
**zsh**
```bash
test -f ~/.zshrc && grep -qxF 'export OPENAI_API_KEY="sk-..."' ~/.zshrc || echo 'export OPENAI_API_KEY="sk-..."' >> ~/.zshrc
source ~/.zshrc
```

**bash**
```bash
test -f ~/.bashrc && grep -qxF 'export OPENAI_API_KEY="sk-..."' ~/.bashrc || echo 'export OPENAI_API_KEY="sk-..."' >> ~/.bashrc
source ~/.bashrc
```

> ENV 名はデフォルトで `OPENAI_API_KEY`。`docs/reference/config-reference.md` の `openai.api_key_env` を変えた場合は、その名称で設定。

---

## 4. プロキシ/企業ネットワークの設定（必要時）
社内プロキシ経由の場合は、以下の環境変数で HTTPS 経路を指定します。

```bash
export HTTPS_PROXY="http://proxy.example.com:8080"
export HTTP_PROXY="$HTTPS_PROXY"
export NO_PROXY="localhost,127.0.0.1"
```

> 社内 CA を利用する環境では、OS/Node の信頼ストアに証明書を正しく登録してください。

---

## 5. プロジェクトの初期化（ローカル）
```bash
# 依存取得 & ビルド
npm ci
npm run build

# サニティチェック
node build/index.js --help
node build/index.js --version
node build/index.js --show-config 2> effective-config.json
```

**期待**: エラー無しで実行でき、`--show-config` のstderr出力（`effective-config.json`）に `effective.model_profiles.answer.model` と `sources` が表示される。

---

## 6. 設定
YAML は任意です。無くても動作します。置く場合の既定パス：

- 既定パス: `~/.config/openai-responses-mcp/config.yaml`  

最小例：
```yaml
model_profiles:
  answer:
    model: gpt-5.2
    reasoning_effort: medium
    verbosity: medium
```

**優先順位**: ENV > YAML > TS defaults。配列は置換し、オブジェクトは深いマージ。

---

## 7. 検証（MCP レイヤ）
```bash
# LDJSON スモーク（OpenAI API鍵不要）
npm run mcp:smoke:ldjson | tee ./mcp-smoke-ldjson.out
grep -c '"jsonrpc":"2.0"' ./mcp-smoke-ldjson.out

# Content-Length スモーク（要 OPENAI_API_KEY）
export OPENAI_API_KEY="sk-..."
npm run mcp:smoke | tee ./mcp-smoke.out
grep -c '^Content-Length:' ./mcp-smoke.out
```

---

## 8. よくあるエラーと対処
| 事象 | 原因 | 対処 |
|---|---|---|
| `Missing API key` | 環境変数未設定 | `export OPENAI_API_KEY=...` |
| `Cannot find module build/index.js` | ビルド未実行 | `npm run build` |
| `Content-Length` 不一致 | フレーミング不備/改行混入 | 再ビルド、`mcp:smoke` 実行 |
| 429/5xx 多発 | API 側混雑/制限 | リトライ上限/タイムアウトを調整 |
| プロキシ関連 TLS 失敗 | 社内 CA 未登録 | OS/Node の信頼ストアに登録 |

---

## 9. 再現性のための推奨
- Node メジャーを固定（例: 全員 v24 系で統一）。
- `--show-config` のstderr出力を保存し、差分監視（CI）で逸脱を検知。
- 秘密は ENV のみ。ログは通常は最小限。デバッグ有効時は送受信 JSON が出力されるため回答本文が含まれる。
