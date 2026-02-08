# Changelog

本プロジェクトの変更履歴です。日付は Asia/Tokyo 基準です。

## [0.10.1] - 2026-02-08
- 依存更新: `openai` を `6.17.0` から `6.18.0` に更新
- 依存更新: `@types/node` を `25.2.0` から `25.2.2` に更新
- 修正: `src/index.ts` の `--help` 表示を実装の受け付けオプションに一致させた
- ドキュメント: `docs/reference/client-setup-claude.md` のトラブルシュート記述を `npx` 前提と矛盾しない内容に修正
- ドキュメント: `README.md` / `docs/README.md` / `docs/reference/config-reference.md` / `docs/reference/environment-setup.md` / `docs/reference/installation.md` / `docs/reference/reproducibility.md` / `docs/reference/system-policy.md` / `docs/spec.md` / `docs/verification.md` を実装に合わせて更新

## [0.10.0] - 2026-02-05
- 依存更新: `openai` を `6.16.0` から `6.17.0` に更新
- 依存更新: `@types/node` を `25.0.10` から `25.2.0` に更新
- ドキュメント: `README.en.md` を削除し、`README.md` の英語リンクを削除
- ドキュメント: `docs/reference/reproducibility.md` の `sources.env` 記述を実装に合わせて修正
- ドキュメント: `docs/verification.md` に `jq` の前提を追記
- ドキュメント: `docs/reference/installation.md` の配置場所記述を修正
- breaking: tools/list の入力スキーマから `style` を削除

## [0.9.0] - 2025-12-21
- breaking: `citations[].url` は URL だけでなく、`oai-weather` 等の **情報源ID** を含み得る（「どこから検索したか」の証跡として採用）。
- fix(answer): `web_search_call` があるのに `url_citation` が 0 件で `citations=[]` になるケースを、`include:["web_search_call.action.sources"]` 由来の情報源（URL/情報源ID）で補完して解消。加えて `url_citation` が存在する場合も、URL が返らない `api` ソース（例: `oai-weather`）の情報源IDは併記して「どこから検索したか」を落とさない。
- fix(answer): `used_search=true` かつ `citations` が 1 件以上のとき、本文に `Sources:` が無い場合はサーバ側で自動付与し、出力契約を安定化。情報源は URL または情報源ID。
- feat(smoke): `scripts/mcp-smoke-apikey.js` に `--tool`（`answer`/`answer_quick`/`answer_detailed`）を追加し、`npm run mcp:answer` で `answer` を簡単に呼べるようにした（`answer_quick` との比較を容易化）。
- docs: 上記仕様（Sources=情報源、apiソース対応、Sources 自動付与）を `docs/spec.md` / `docs/reference/system-policy.md` / `docs/verification.md` / `docs/README.md` に反映。

## [0.8.0] - 2025-12-20
- feat(config): `model_profiles.answer.model` の既定値を `gpt-5.2` へ更新。
- feat(config): `reasoning_effort` に Extra high（API表記 `xhigh`）を追加し、`low`/`medium`/`high`/`xhigh` を許容。
- deps: OpenAI JS SDK `openai` を `^6.16.0` へ更新（`xhigh` を型定義に反映）。
- fix(protocol): `@types/node` の型変更に合わせ、stdin の chunk を Buffer に正規化して TypeScript ビルドを安定化。
- fix(cli): `--help` の既定パス表記でバックスラッシュが欠落する問題を修正。
- fix(smoke): `mcp:quick` が `tools/call(answer_quick)` の応答を受け取るまで待機して終了するよう改善（web_search で 4 秒超となるケースに対応）。

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

## [0.5.0] - 2025-08-24
- feat(protocol): MCP キャンセルに対応（`notifications/cancelled`）。該当 `requestId` の処理を中断し、以後は `result/error` を送らない。未登録/完了済みは無視。
- feat(runtime): OpenAI 呼び出しに `AbortSignal` を伝搬。キャンセル時はリトライを行わず即中断。
- fix(server): キャンセル直後の例外でもエラー応答を抑止するよう実行順序と in-flight 管理を調整。
- feat(tests/ci): `scripts/test-*.js` を追加（tools-list, cancel-noinflight, cancel-during-call）。CI に常時/条件テストを組み込み。
- docs: `docs/spec.md` に「6.1 キャンセル」を追加、`docs/verification.md` に自動テスト手順を追記。

## [0.4.8] - 2025-08-23
- fix(protocol): `initialize` 応答から `capabilities.roots` を削除（`roots/list` 呼び出しによる切断を予防）。
- feat(protocol): `ping` を最小実装（ヘルスチェック用、空オブジェクトで成功応答）。
- feat(logging): デバッグ指定の統一（CLI/ENV/YAML 同義）。`--debug` / `DEBUG=1|<path>` / `server.debug(.debug_file)` の優先度を CLI > ENV > YAML で統一。`DEBUG_MCP` は廃止。
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
  - `web_search` を常時許可し、実際の検索実行はモデルの判断に委ねる
  - 構造化出力（`answer`（本文）・`used_search`・`citations[]`・`model`）
  - System Policy の参照先: `src/policy/system-policy.ts`
  - MCP stdio 実装（`initialize` / `tools/list` / `tools/call`）
