
# Transports — `docs/reference/transports.md`
最終更新: 2026-01-14 Asia/Tokyo

本ドキュメントは **openai-responses-mcp** が実装するトランスポート仕様を記述します。  
現行は **stdio** のみ実装。

---

## 1. stdio: 実装済み

### 1.1 物理レイヤ
- **双方向**：プロセスの `stdin`/`stdout` を使用。バイナリ不可。**UTF-8** テキスト。
- **フレーミング**：優先は `Content-Length: <n>\r\n\r\n<payload>` の固定ヘッダ。複数メッセージを連結可能。
- **互換モード（フォールバック）**：クライアントが Content-Length を送らない場合、**行区切りJSON（NDJSON風）** も受理。受信で行モードを検出した場合、以後のサーバ応答も **JSON + `\n`** で返す。環境変数 `MCP_LINE_MODE` が `1` の場合は、受信方式に関係なくサーバ応答を **JSON + `\n`** で返す。
- **ペイロード**：`application/json; charset=utf-8`。推奨は `\n`。
- **エンコーディング**：UTF-8。BOM 不可。

### 1.2 JSON-RPC 互換
- **バージョン**：`"jsonrpc":"2.0"`。互換。
- **メソッド**：`initialize` / `tools/list` / `tools/call` / `ping` を使用。`ping` はヘルスチェック。
- **ID**：数値/文字列いずれも可。リクエストとレスポンスで一致させる。

### 1.3 初期化
**受信（例）**
```http
Content-Length: 118

{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{}}}
```
**送信（例）**
```http
Content-Length: 142

{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"openai-responses-mcp","version":"<pkg.version>"}}}
```

### 1.4 ツール一覧
**受信（例）**
```http
Content-Length: 52

{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```
**送信（例）**
```http
Content-Length: <bytes>

{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"answer","description":"Search the web when needed and provide balanced, well-sourced answers. This is the standard general-purpose tool.","inputSchema":{"type":"object","properties":{"query":{"type":"string"},"recency_days":{"type":"number"},"max_results":{"type":"number"},"domains":{"type":"array","items":{"type":"string"}}},"required":["query"]}},{"name":"answer_detailed","description":"Perform comprehensive analysis with thorough research and detailed explanations. Best for complex questions requiring deep investigation.","inputSchema":{"type":"object","properties":{"query":{"type":"string"},"recency_days":{"type":"number"},"max_results":{"type":"number"},"domains":{"type":"array","items":{"type":"string"}}},"required":["query"]}},{"name":"answer_quick","description":"Provide fast, concise answers optimized for speed. Best for simple lookups or urgent questions.","inputSchema":{"type":"object","properties":{"query":{"type":"string"}},"required":["query"]}}]}} 
```

### 1.5 ツール呼び出し（answer）
**受信（例）**
```http
Content-Length: 156

{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"answer","arguments":{"query":"HTTP 404 の意味は？"}}}
```
**送信（例・成功、本文は `answer` に格納）**
```http
Content-Length: 204

{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{\"answer\":\"...\",\"used_search\":false,\"citations\":[],\"model\":\"gpt-5.2\"}"}]}}
```

**送信（例・エラー）**
```http
Content-Length: 128

{"jsonrpc":"2.0","id":3,"error":{"code":-32001,"message":"answer failed","data":{"message":"..."}}}
```

### 1.6 ping（ヘルスチェック）
**受信（例）**
```http
Content-Length: 36

{"jsonrpc":"2.0","id":99,"method":"ping"}
```
**送信（例）**
```http
Content-Length: 28

{"jsonrpc":"2.0","id":99,"result":{}}
```

### 1.7 実装注意点
- **Content-Length は UTF-8 バイト長**で算出（`Buffer.byteLength(json, 'utf8')`）。
- ストリームは**フラッシュ**されるまでクライアントに届かない。`stdout.write` 直後に `\n` は書かない。ヘッダ末尾の `\r\n\r\n` を忘れない。
- **バックプレッシャ**：`stdout.write` をそのまま実行する。drain 待機は行わない。
- **最大メッセージ長**：実装上の固定上限は設けていない。実務では 1～2MB 程度で分割を検討。
- **並列リクエスト**：ID をキーに同時進行可。順不同応答を許容すること。

### 1.8 ロギング & トラブルシュート
- **デバッグモード**：CLI/ENV/YAML の同義判定（優先度: CLI > ENV > YAML）により有効化される。起動時に確定した単一判定（`isDebug()`）に従い、stderr に段階ログを出力（例：`stdin chunk=...` / `headerEnd=...` / `recv method=...` / `send (line|framed) bytes=...` / `send json=...`）。
- **フレーミング崩れの典型**：`Content-Length` ミスマッチ、`\r\n\r\n` 欠落、BOM 混入。行区切りJSONにも自動フォールバック。
- **検査**：必要に応じて `npm run mcp:smoke` で `initialize → tools/list → tools/call` の 3応答を確認する。

---

## 3. 互換性ポリシー
- `protocolVersion` は現行 `2025-06-18` 固定。`initialize` でのネゴシエーションは行わない。
- `tools` のスキーマは `tools/list` の出力に従う。

---

## 4. 試験（Transport-level）
- **stdio**：`scripts/mcp-smoke.js` が最小試験。`initialize`→`tools/list`→`tools/call` の成功を確認。
