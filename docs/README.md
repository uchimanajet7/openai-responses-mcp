
# ドキュメント入口（Index）— `docs/README.md`
最終更新: 2026-02-08 Asia/Tokyo

このフォルダは **openai-responses-mcp** の公式ドキュメント一式です。  
**仕様・挙動は実装が正**です。まず `spec.md` を読んでください。ほかは参照・運用・検証のための補助資料です。

---

## 1. クイックスタート
- 1) 依存導入: `npm ci`
- 2) ビルド: `npm run build`
- 3) 実効設定の保存: `node build/index.js --show-config 2> effective-config.json`
- 4) 最小起動: `node build/index.js --stdio`
- 5) スモーク: `npm run mcp:smoke:ldjson`

> API キーは **環境変数**で渡します。OpenAI API を呼び出すスモークや実行で必要です。例: `export OPENAI_API_KEY="sk-..."`。

---

## 2. 正準仕様（必読）
- **[spec.md](./spec.md)** — プロダクトの正準仕様（MCP I/F、`answer` I/O、System Policy、設定優先順位、DoD まで）

---

## 3. 運用系ドキュメント
- **[changelog.md](./changelog.md)** — 変更履歴（日付は Asia/Tokyo）
- **[verification.md](./verification.md)** — E2E 検証手順（`jq` 検査例つき）

---

## 4. リファレンス（仕様の詳細）
- **[reference/config-reference.md](./reference/config-reference.md)** — 設定スキーマと優先順位: ENV > YAML > TS defaults
- **[reference/system-policy.md](./reference/system-policy.md)** — System Policy の参照先: `src/policy/system-policy.ts`
- **[reference/transports.md](./reference/transports.md)** — トランスポート仕様。標準入出力の実装のみ。
- **[reference/client-setup-claude.md](./reference/client-setup-claude.md)** — Claude Code/Desktop への登録手順（stdio）
- **[reference/installation.md](./reference/installation.md)** — インストールとローカル検証（npm 固定）
- **[reference/environment-setup.md](./reference/environment-setup.md)** — OS 別の環境準備とプロキシ設定
- **[reference/reproducibility.md](./reference/reproducibility.md)** — 再現性・再構築ガイド（スナップショット運用）

---

## 5. ファイル構成（要点）
```
openai-responses-mcp/
  ├─ src/                 # TypeScript 実装
  │   ├─ config/          # defaults/load/paths（優先順位ロジック含む）
  │   ├─ mcp/             # protocol/server（stdio JSON-RPC + framing）
  │   └─ tools/           # answer（Responses API + web_search）
  ├─ scripts/             # mcp-smoke.js / mcp-smoke-ldjson.js など
  ├─ build/               # ビルド生成物（`npm run build` 後に生成）
  ├─ config/
  │   └─ config.yaml.example
  ├─ docs/                # ← 本フォルダ（仕様・運用・参照）
  ├─ package.json
  └─ tsconfig.json
```

---

## 6. 設定優先順位（再掲・短縮版）
- 設定値の優先順位: **ENV > YAML > TS defaults**。YAML は `--config <path>` で読み込むファイルを指定する。  
- 配列は**置換**、オブジェクトは**深いマージ**。  
- 実効値は `--show-config` で JSON 出力（stderr）。

---

## 7. DoD（現在の要件）
- HTTP 404 → `answer`（本文）が返り、`used_search=false`, `citations=[]`
- 本日 YYYY-MM-DD の東京の天気 → `answer`（本文）に **情報源 + ISO 日付**（URL または情報源ID）、`used_search=true`、`citations>=1`


---

## 8. コントリビューション・方針（抜粋）
- 仕様変更は **spec.md を先に更新**（正準）。
- 依存更新はパッチ/マイナーを `changelog.md` に記録。
- `.snapshots/` を使った**形の回帰チェック**を推奨。

---

## 9. 連絡とライセンス
- ライセンス: MIT（`package.json` に準拠）
- 連絡: GitHub の Pull Request / Issue でお願いします。
