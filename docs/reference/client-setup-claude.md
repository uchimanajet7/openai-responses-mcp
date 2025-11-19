
# Claude Code / Claude Desktop 連携手順 — `docs/reference/client-setup-claude.md`
最終更新: 2025-08-09（Asia/Tokyo）

本ドキュメントは **openai-responses-mcp**（stdio）を Claude 系クライアントに登録して利用するための、
実務向けの完全手順です。**要約なし**。クライアント固有の設定ファイル位置はバージョンで変わるため、
ここでは**設定フォーマットと検証手順**を厳密に記述します。

---

## 1. 前提（サーバ側）
- Node.js 20+、npm。
- OpenAI API キーは **環境変数**で用意（例: `OPENAI_API_KEY`）。

---

## 2. Claude クライアントでの MCP サーバ登録（共通フォーマット）
Claude 系クライアント（Claude Code / Claude Desktop）は、共通して **`mcpServers`** という
マップ構造でサーバを登録します。**設定ファイルの正確な場所はクライアントの UI（設定 → 開発者向け）から開く**こと。
パスを直指定せず、**必ず UI から開いたファイル**を編集してください。

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
    model: gpt-5.1
    reasoning_effort: medium
    verbosity: medium
  answer_detailed:
    model: gpt-5.1-codex
    reasoning_effort: high
    verbosity: high
  answer_quick:
    model: gpt-5.1-chat-latest
    reasoning_effort: low
    verbosity: low
```
- **`--stdio` は必須**（Claude からの起動は stdio）。
- **必須環境変数**: `OPENAI_API_KEY`。
- **セキュリティ**: APIキーはENVで渡す。YAMLに秘匿情報は書かない。

### 2.3 リモートで実行したい場合（SSH 経由の例）
```json
{
  "mcpServers": {
    "openai-responses-remote": {
      "command": "ssh",
      "args": [
        "my-host.example.com",
        "node", "/ABS/PATH/openai-responses-mcp/build/index.js", "--stdio"
      ],
      "env": {
        "OPENAI_API_KEY": "sk-..."
      }
    }
  }
}
```
> SSH 経由では **接続先に Node とビルド済みファイル**が必要。鍵/接続設定は OS 側で準備する。

---

## 2.4 環境変数（必要最小限）
| 環境変数 | 必須 | 説明 |
|---|---|---|
| `OPENAI_API_KEY` | ✅ | OpenAI APIキー |

---

## 3. 再起動と適用
- 設定ファイルを保存後、**Claude クライアントを完全終了 → 再起動**。
- 起動時に MCP サーバが立ち上がり、**initialize → tools/list** が送られる。

---

## 4. 動作確認（クライアント側での観察）
- クライアントの **開発者ログ/デベロッパーツール**を開く（UI から辿る）。
- 次の 3 つのメッセージが **Content-Length** 付きで現れる：
  1) `initialize`（クライアント → サーバ）
  2) `tools/list`（クライアント → サーバ）
  3) `result`（サーバ → クライアント; tools 一覧に3つのツールがある）

**期待値（例）**
```http
Content-Length: 157

{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"openai-responses-mcp","version":"0.7.0"}}}
```
`tools`内に`answer`、`answer_detailed`、`answer_quick`の3つが表示されれば登録成功。

---

## 5. 実地テスト（Claude からの利用）
- Claude に通常どおり指示を与える。**時事性がある質問**（例: 「本日 YYYY-MM-DD の東京の天気」）では、
  モデルが `web_search` を必要と判断すると **MCP サーバの `answer` が呼ばれ**、外部出典を含む回答が返る。
- **安定知識の質問**（例: HTTP 404 の意味）は `web_search` を使わず、`citations` なしで答える。

> クライアントのプロンプト方針で「エラー時には必ず MCP `answer` を呼ぶ」等を指示している場合、
> そのルールに従って自動的に `answer` が起動される。

---

## 6. トラブルシュート
- **何も表示されない**: パスが相対/誤り。**絶対パス**で指定。実行権限の不足（Windows の拡張子関連含む）。
- **API キー未設定**: `Missing API key: set OPENAI_API_KEY`。設定ファイルの `env` で値を渡す。
- **フレーミングエラー**: `Content-Length` 不一致。ビルドし直し（`npm run build`）。
- **Timeout/429**: ネットワーク混雑または API 側都合。自動リトライ＆フォールバックが入る。

---

## 7. セキュリティ / 運用
- キーや回答本文の**フルログ保存はしない**。必要な最小のメタ情報のみ記録する。
- 機密性が高い環境では、**SSH 経由**でリモート実行し、ローカルに鍵を残さない運用も可能。

---

## 8. 解除 / ロールバック
- 設定ファイルから該当エントリを削除し、クライアントを再起動。
- 一時的に無効化する場合は、`command` を無効コマンドに置き換えるのではなく、**エントリ削除**を推奨。
