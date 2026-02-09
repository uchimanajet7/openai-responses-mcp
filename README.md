# openai-responses-mcp

OpenAI Responses API を推論コアに採用した軽量な MCP サーバです。  
`web_search` を常時許可し、実際に検索を行うかはモデルが自律判断します。Claude Code 等の MCP クライアントから stdio で利用します。

重要: 仕様・挙動は実装が正です。まず `docs/spec.md` を読んでください。

---

## Repository Structure
- `src/`                         : TypeScript ソース
- `scripts/`                     : 検証/補助スクリプト。例: `mcp-smoke*`, `clean.js`
- `config/`
  - `config.yaml.example`        : 設定サンプル
  - `policy.md.example`          : 外部 System Policy のサンプル
- `docs/`                        : 正準仕様/リファレンス/検証手順
  - `spec.md`                    : 正準仕様
  - `reference/`                 : 設定・導入・連携リファレンス
  - `verification.md`            : E2E 検証手順
- `README.md`                    : プロジェクト概要/クイックスタート
- `LICENSE`                      : ライセンス
- `package.json`, `package-lock.json` : npm 設定/依存固定
- `tsconfig.json`                : TypeScript 設定
- `.gitignore`                   : Git 除外設定

---

## 特長
- Responses API 準拠（公式JS SDK `openai`）
- 検索はモデルに委譲（`web_search` を常時許可）
- 構造化出力は `answer` 本文、`used_search`、`citations[]`、`model` を返す
  - `citations[]` は **情報源**（URL または `oai-weather` 等の情報源ID）を返す
- System Policy の参照先: `src/policy/system-policy.ts`
- MCP stdio 実装（`initialize`/`tools/list`/`tools/call`）

## 要件
- OS: macOS / Linux
- Node.js: 必須は v20 以上。CI は v20 系で検証。
- npm（Node 同梱）
- OpenAI API キー（環境変数で渡す）

---

## 必須設定だけで起動できる最小構成
- 必須設定: 環境変数 `OPENAI_API_KEY` のみ。
- 起動例:
  - `export OPENAI_API_KEY="sk-..." && npx openai-responses-mcp@latest --stdio`

使う場合の既定パスは `~/.config/openai-responses-mcp/config.yaml` です。

---

## MCPとして使う
MCPクライアントから利用する場合に参考にしてください。

### 1) Claude Code への登録例
- `~/.claude.json` へ以下の項目を追加

```json
{
  "mcpServers": {
    "openai-responses": {
      "command": "npx",
      "args": ["openai-responses-mcp@latest", "--stdio"],
      "env": { "OPENAI_API_KEY": "sk-..." }
    }
  }
}
```

- Claude Code CLI では以下を実行

```sh
claude mcp add -s user -t stdio openai-responses -e OPENAI_API_KEY=sk-xxxx -- npx openai-responses-mcp@latest --stdio
```

### 2) OpenAI Codex への登録例
- `~/.codex/config.toml` へ以下の項目を追加

```toml
[mcp_servers.openai-responses]
command = "npx"
args = ["-y", "openai-responses-mcp@latest", "--stdio"]
env = { OPENAI_API_KEY = "sk-xxxx" }
```

### 3) CLAUDE.md や AGENTS.md への指示例
```markdown
### 問題解決方針

開発中に問題や実装上の困難に遭遇した場合：

1. **必ず openai-responses MCP に相談すること**  
   - 相談は最優先かつ必須とする  
   - 独自判断での実装は絶対に行わない  

2. **質問は必ず英語で行うこと**  
   - openai-responses MCP への質問はすべて英語で記載する  

3. **代替手法や最新ベストプラクティスの調査**  
   - openai-responses MCP を活用して解決手段や最新のベストプラクティスを収集する  

4. **複数の解決アプローチを検討すること**  
   - 一つの方法に即決せず、複数の選択肢を比較検討した上で方針を決定する  

5. **解決策を文書化すること**  
   - 問題解決後は、再発時に迅速に対応できるよう手順や解決方法を記録しておく  
```

### 4) npx で即実行
```bash
export OPENAI_API_KEY="sk-..." 
npx openai-responses-mcp@latest --stdio
```
最小起動は `--stdio` のみ。必要に応じて `--debug <path>` / `--config <path>` / `--show-config` を付与する。

### 5) 設定
既定パス: `~/.config/openai-responses-mcp/config.yaml`

最小例:

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
サンプル: `config/config.yaml.example`

外部 policy を使う場合は次のように設定します。

```yaml
policy:
  system:
    source: file
    path: ~/.config/openai-responses-mcp/policy.md
    merge: append   # replace | prepend | append
```
サンプル: `config/policy.md.example`

### 6) ログとデバッグ
- デバッグON: `--debug` / `DEBUG=1|true` / YAML `server.debug: true`。stderr に出力する。送受信 JSON が出力されるため回答本文が含まれる。優先度は CLI > ENV > YAML。
- デバッグON: ファイルへも出力する。 `--debug ./_debug.log` または `DEBUG=./_debug.log`
- デバッグOFF: デバッグログは出さない。エラー時のみ標準エラーに出力する。

YAMLでの制御:
- `server.debug: true|false`。YAMLだけでも全モジュールに反映する。
- `server.debug_file: <path|null>`。`server.debug: true` のときにのみ有効で、stderr をファイルへTEEミラーする。

---

## 開発者向け（クローンして開発）

### 1) 取得とビルド
```bash
git clone https://github.com/uchimanajet7/openai-responses-mcp.git
cd openai-responses-mcp
npm i
npm run build
```

### 2) スモークテスト（MCPフレーミング）
```bash
npm run mcp:smoke | tee ./mcp-smoke.out
grep -c '^Content-Length:' ./mcp-smoke.out   # 3 以上でOK
```

### 3) ローカル起動（stdio）
```bash
export OPENAI_API_KEY="sk-..."
node build/index.js --stdio --debug ./_debug.log
```

### 4) デモ（OpenAIへの問い合わせサンプル）
```bash
npm run mcp:quick -- "今日の東京の気温"   # answer_quick
npm run mcp:answer -- "今日の東京の気温"  # answer
npm run mcp:smoke:ldjson   # NDJSON互換の疎通確認
```

### 5) ドキュメント（参照先）
- 正準仕様: `docs/spec.md`
- リファレンス: `docs/reference/config-reference.md` / `docs/reference/client-setup-claude.md`
- 検証手順: `docs/verification.md`

---

## メンテナ向け（配布）

### npm パッケージ確認と公開
```bash
npm pack --dry-run    # 同梱物を確認。build/ と README.md と LICENSE と package.json と config/*.example
git tag vX.Y.Z && git push --tags   # GitHub Actions で公開。release.yml が実行される
```

---

## トラブルシュート（要点）
- `Missing API key`: `OPENAI_API_KEY` 未設定。ENV を見直し
- `Cannot find module build/index.js`: ビルド未実行 → `npm run build`
- フレーミング不一致: `npm run mcp:smoke` で確認し再ビルド
- 429/5xx 多発: `request.max_retries`/`timeout_ms` を調整（YAML）

---

## ライセンス
MIT
