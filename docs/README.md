
# ドキュメント入口（Index）— `docs/README.md`
最終更新: 2025-08-15（Asia/Tokyo, AI確認）

このフォルダは **openai-responses-mcp** の公式ドキュメント一式です。  
**仕様は `spec.md` が正準（canonical）**であり、他は参照・運用・検証のための付属文書です。

---

## 1. クイックスタート
```bash
# 依存＆ビルド（再現性重視）
npm ci
npm run build

# 実効設定の確認（stderrにJSON出力）
npx openai-responses-mcp --show-config 2> effective-config.json

# 最小起動（MCP stdio）
npx openai-responses-mcp --stdio

# スモーク（疎通）
npm run mcp:smoke:ldjson
```

> API キーは **環境変数**で渡す（OpenAI APIを実行する一部のスモーク・実行で必要）: `export OPENAI_API_KEY="sk-..."`（PowerShell は `$env:OPENAI_API_KEY="sk-..."`）。

---

## 2. 正準仕様（必読）
- **[spec.md](./spec.md)** — プロダクトの正準仕様（MCP I/F、`answer` I/O、System Policy、設定優先順位、DoD まで）

---

## 3. 運用系ドキュメント
- **[changelog.md](./changelog.md)** — 変更履歴（日付は Asia/Tokyo）
- **[verification.md](./verification.md)** — E2E 検証手順（`jq` 検査例つき）

---

## 4. リファレンス（仕様の詳細）
- **[reference/config-reference.md](./reference/config-reference.md)** — 設定スキーマと優先順位（CLI > ENV > YAML > TS）
- **[reference/system-policy.md](./reference/system-policy.md)** — System Policy の参照先（SSOTはコード: `src/policy/system-policy.ts`）
- **[reference/transports.md](./reference/transports.md)** — トランスポート仕様（stdio 実装済み / HTTP 設計）
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
- **CLI > ENV > YAML > TS defaults**（後勝ち）  
- 配列は**置換**、オブジェクトは**深いマージ**。  
- 実効値は `--show-config` で JSON 出力（stderr）。

---

## 7. DoD（現在の要件）
- HTTP 404 → `used_search=false`, `citations=[]`
- 本日 YYYY-MM-DD の東京の天気 → `used_search=true`、本文に **情報源 + ISO 日付**（URL または情報源ID）、`citations>=1`


---

## 8. コントリビューション・方針（抜粋）
- 仕様変更は **spec.md を先に更新**（正準）。
- 依存更新はパッチ/マイナーを `changelog.md` に記録。
- `.snapshots/` を使った**形の回帰チェック**を推奨。

---

## 9. 連絡とライセンス
- ライセンス: MIT（`package.json` に準拠）
- 連絡: Pull Request / Issue でお願いします。
