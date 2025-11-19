
# Transports — `docs/reference/transports.md`
最終更新: 2025-08-15（Asia/Tokyo, AI確認）

本ドキュメントは **openai-responses-mcp** が実装するトランスポート仕様を記述します。  
現行は **stdio** のみ実装。

---

## 1. stdio（実装済み）

### 1.1 物理レイヤ
- **双方向**：プロセスの `stdin`/`stdout` を使用（バイナリ不可、**UTF-8** テキスト）。
- **フレーミング（優先）**：`Content-Length: <n>\r\n\r\n<payload>` 固定ヘッダ。複数メッセージを連結可能。
- **互換モード（フォールバック）**：クライアントが Content-Length を送らない場合、**行区切りJSON（NDJSON風）** も受理。受信で行モードを検出した場合、以後のサーバ応答も **JSON + `\n`** で返す。
- **ペイロード**：`application/json; charset=utf-8`。改行は任意（`\n` 推奨）。
- **エンコーディング**：UTF-8。BOM 不可。

### 1.2 JSON-RPC 互換
- **バージョン**：`"jsonrpc":"2.0"`（互換）。
- **メソッド**：`initialize` / `tools/list` / `tools/call` / `ping` を使用（`ping` は任意のヘルスチェック）。
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
**送信（例・answer のみ）**
```http
Content-Length: 458

{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"answer","description":"必要に応じてWeb検索を実行し、根拠（出典付き）で回答を返す","inputSchema":{"type":"object","properties":{"query":{"type":"string"},"recency_days":{"type":"number"},"max_results":{"type":"number"},"domains":{"type":"array","items":{"type":"string"}},"style":{"enum":["summary","bullets","citations-only"]}},"required":["query"]}}]}} 
```

### 1.5 ツール呼び出し（answer）
**受信（例）**
```http
Content-Length: 156

{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"answer","arguments":{"query":"HTTP 404 の意味は？","style":"summary"}}}
```
**送信（例・成功）**
```http
Content-Length: 204

{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"{\"answer\":\"...\",\"used_search\":false,\"citations\":[],\"model\":\"gpt-5.1\"}"}]}}
```

**送信（例・エラー）**
```http
Content-Length: 128

{"jsonrpc":"2.0","id":3,"error":{"code":-32001,"message":"answer: invalid arguments","data":{"reason":"query is required"}}}
```

### 1.6 ping（任意のヘルスチェック）
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
- ストリームは**フラッシュ**されるまでクライアントに届かない。`stdout.write` 直後に `\n` は不要、ヘッダ末尾の `\r\n\r\n` を忘れない。
- **バックプレッシャ**：Node.js の `stdout.write()` が `false` を返す場合は `drain` 待機。
- **最大メッセージ長**：制限なしだが、実務では 1～2MB 程度で分割を検討。
- **並列リクエスト**：ID をキーに同時進行可。順不同応答を許容すること。

### 1.8 ロギング & トラブルシュート
- **デバッグモード**：CLI/ENV/YAML の同義判定（優先度: CLI > ENV > YAML）により有効化される。起動時に確定した単一判定（`isDebug()`）に従い、stderr に段階ログを出力（例：`stdin chunk=...` / `headerEnd=...` / `recv method=...` / `send (line|framed) bytes=...` / `send json=...`）。
- **フレーミング崩れの典型**：`Content-Length` ミスマッチ、`\r\n\r\n` 欠落、BOM 混入。行区切りJSONにも自動フォールバック。
- **検査**：`npm run mcp:smoke` で `initialize → tools/list → tools/call` の 3応答を確認。

---

<!-- HTTP（streamable_http）に関する設計案は docs/_drafts/transports-http.md へ退避 -->

## 3. 互換性ポリシー
- `protocolVersion` は現行 `2025-06-18`。将来変更時は**後方互換**のため `initialize` でネゴシエート。
- `tools` のスキーマは **後方互換を前提に追記**（必須フィールドの削除/意味変更は不可）。

---

## 4. 試験（Transport-level）
- **stdio**：`scripts/mcp-smoke.js` が最小試験。`initialize`→`tools/list`→`tools/call` の成功を確認。
