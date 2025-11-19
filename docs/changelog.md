# Changelog

本プロジェクトの変更履歴です。日付は Asia/Tokyo 基準です。

## [0.7.0] - 2025-11-19
- feat(config): `model_profiles.answer.model` の既定値を `gpt-5.1` へ更新し、Responses API で標準的に GPT-5.1 を利用。
- docs: `docs/spec.md` / `docs/reference/*` / `README.*` / `docs/verification.md` など全体の設定例・期待値を `gpt-5.1` 系に刷新し、新バージョン表記へ統一。
- config: `config/config.yaml.example` の `model_profiles` サンプルを `gpt-5.1` / `gpt-5.1-codex` / `gpt-5.1-chat-latest` に合わせて更新。

## [0.6.0] - 2025-08-27
- feat(logging): デバッグ判定を単一化。CLI/ENV/YAML を同義化し、優先度を CLI > ENV > YAML に統一（起動時に最終決定→以降は isDebug() を参照）。
- refactor(logging): `src/debug/state.ts` を追加し、stderr→ファイルTEEミラーを含むデバッグ出力経路を一元化。
- breaking(logging): `DEBUG_MCP` / `MCP_DEBUG` 環境変数のサポートを削除（今後は `DEBUG=1|true|<path>` のみ）。
- docs: `docs/spec.md` / `docs/reference/*` / `README.*` を単一判定・同義化仕様へ更新。`server.log_level` の記述を削除。
- config: `config/config.yaml.example` を `server.debug` / `server.debug_file` / `show_config_on_start` に更新。
- chore(tests): `_temp_/_ai_/run-yaml-debug-test.js` を追加。スクリプトの `DEBUG_MCP` を `DEBUG` に統一。

## [0.5.0] - 2025-08-24
- feat(protocol): MCP キャンセルに対応（`notifications/cancelled`）。該当 `requestId` の処理を中断し、以後は `result/error` を送らない。未登録/完了済みは無視。
- feat(runtime): OpenAI 呼び出しに `AbortSignal` を伝搬。キャンセル時はリトライを行わず即中断。
- fix(server): キャンセル直後の例外でもエラー応答を抑止するよう実行順序と in-flight 管理を調整。
- feat(tests/ci): `scripts/test-*.js` を追加（tools-list, cancel-noinflight, cancel-during-call）。CI に常時/条件テストを組み込み。
- docs: `docs/spec.md` に「6.1 キャンセル」を追加、`docs/verification.md` に自動テスト手順を追記。

## [0.4.8] - 2025-08-23
- fix(protocol): `initialize` 応答から `capabilities.roots` を削除（未実装機能の広告を停止）。Claude Code からの `roots/list` 呼び出しによる切断を予防。
- feat(protocol): `ping` を最小実装（ヘルスチェック用、空オブジェクトで成功応答）。
- feat(logging): デバッグ指定の統一（CLI/ENV/YAML 同義）。`--debug` / `DEBUG=1|<path>` / `server.debug(.debug_file)` の優先度を CLI > ENV > YAML で統一。`DEBUG_MCP` は廃止（後方互換のため非推奨扱いのみ）。
- docs: `protocolVersion` を `2025-06-18` に統一。トランスポート/仕様の該当セクション更新。
- chore: スモークに `scripts/mcp-smoke-ping.js` を追加（`ping` 確認用）。

## [0.4.7] - 2025-08-19
- docs: 表現を統一（「薄い/Thin MCP server」→「軽量な/Lightweight MCP server」）
  - 対象: `README.md`, `docs/spec.md`, `package.json(description)`
- meta: `docs/spec.md` の版数・最終更新日を更新
- note: 機能・API・設定仕様に変更なし（ドキュメントのみ）

## [0.4.6] - 2025-08-19
- 初回正式リリース（First official release）
- 特長:
  - OpenAI Responses API 準拠（公式JS SDK `openai`）
  - `web_search` を常時許可し、実際の検索実行はモデルに委譲
  - 構造化出力（本文・`used_search`・`citations[]`・`model`）
  - System Policy はコード内SSOT（`src/policy/system-policy.ts`）
  - MCP stdio 実装（`initialize` / `tools/list` / `tools/call`）
