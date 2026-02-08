
# Claude Code 連携手順 — `docs/reference/client-setup-claude.md`
最終更新: 2026-02-08 Asia/Tokyo

本ドキュメントは **openai-responses-mcp**（stdio）を Claude Code（CLI）に登録して利用するための、
実務向けの完全手順です。**要約なし**。設定ファイル `~/.claude.json` を前提に、
**設定フォーマットと検証手順**を記述します。

---

## 1. 前提（サーバ側）
- Node.js 20+、npm。
- OpenAI API キーは **環境変数**で用意（例: `OPENAI_API_KEY`）。

---

## 2. Claude Code での MCP サーバ登録
Claude Code（CLI）は、ユーザー設定ファイル `~/.claude.json` の **`mcpServers`** にサーバを登録します。

### 2.1 設定例（最小・推奨）
```json
{
  "mcpServers": {
    "openai-responses": {
      "command": "npx",
      "args": ["openai-responses-mcp@latest", "--stdio"],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```
> YAML（`~/.config/openai-responses-mcp/config.yaml`）で `model_profiles` を設定している場合、そちらが適用されます。

### 2.2 プロファイル設定（YAML）
`~/.config/openai-responses-mcp/config.yaml` に以下のように記述します。
```yaml
model_profiles:
  answer:
    model: gpt-5.2
    reasoning_effort: medium
    verbosity: medium
  answer_detailed:
    model: gpt-5.1-codex
    reasoning_effort: high
    verbosity: high
  answer_quick:
    model: gpt-5.2-chat-latest
    reasoning_effort: low
    verbosity: low
```
- **`--stdio` は必須**（Claude からの起動は stdio）。
- **必須環境変数**: `OPENAI_API_KEY`。
- **セキュリティ**: APIキーはENVで渡す。YAMLに秘匿情報は書かない。

## 2.3 環境変数（必要最小限）
| 環境変数 | 必須 | 説明 |
|---|---|---|
| `OPENAI_API_KEY` | ✅ | OpenAI APIキー |

---

## 3. 再起動と適用
- 設定ファイルを保存後、**Claude Code を終了 → 再起動**。
- 起動時に MCP サーバが立ち上がり、**initialize → tools/list** が送られる。

## 4. 動作確認（Claude Code 側）
`claude mcp list` で `openai-responses` が表示され、Claude Code 内で `/mcp` から `answer` / `answer_detailed` / `answer_quick` が確認できれば登録成功。

---

## 5. 実地テスト（Claude からの利用）
- Claude に通常どおり指示を与える。**時事性がある質問**（例: 「本日 YYYY-MM-DD の東京の天気」）では、
  モデルが `web_search` を必要と判断すると **MCP サーバの `answer` が呼ばれ**、外部出典を含む回答が返る。
- **安定知識の質問**（例: HTTP 404 の意味）は `web_search` を使わず、`citations` なしで答える。

> クライアントのプロンプト方針で「エラー時には必ず MCP `answer` を呼ぶ」等を指示している場合、
> そのルールに従って自動的に `answer` が起動される。

---

## 6. トラブルシュート
- **何も表示されない**: `command` が `node` または実行ファイルのパスの場合は **絶対パス**を指定し、参照先と実行権限を確認する。`npx` を使う場合は `npx` がパス環境変数に含まれているかを確認する。
- **API キー未設定**: `Missing API key: set OPENAI_API_KEY`。設定ファイルの `env` で値を渡す。
- **フレーミングエラー**: `Content-Length` 不一致。ビルドし直し（`npm run build`）。
- **Timeout/429**: ネットワーク混雑または API 側都合。自動リトライが入る。

---

## 7. セキュリティ / 運用
- ログは通常は最小限。デバッグ有効時は送受信 JSON が出力されるため回答本文が含まれる。

---

## 8. 解除 / ロールバック
- 設定ファイルから該当エントリを削除し、クライアントを再起動。
- 一時的に無効化する場合は、`command` を無効コマンドに置き換えるのではなく、**エントリ削除**を推奨。
