
# System Policy — 参照先（SSOT: コード）
最終更新: 2025-12-21（Asia/Tokyo）

本プロジェクトでは System Policy のソース・オブ・トゥルース（SSOT）を**コード側**に一本化しています。Responses API の `instructions` には、コードに定義された定数を**そのまま**与えます。

- SSOT: `src/policy/system-policy.ts`
  - `export const SYSTEM_POLICY`（本文）
  - `export const SYSTEM_POLICY_REV`（改定版識別）

このドキュメントは参照ガイドです。本文の複製は保持しません。内容変更は必ず `src/policy/system-policy.ts` を更新してください。

---

## 1. 運用原則
- 本サーバは MCP ツール `answer` のバックエンドであり、**OpenAI Responses API** を用いる。
- 毎リクエストで `tools: [{"type":"web_search"}]` を **常時許可**する。検索を実行するかどうかは**モデルが判断**する。
- 返却は本文・検索使用有無・出典（URL/日付/題名）・使用モデルを**構造化**して返す（出力契約は後述）。
- 時制/相対日付は **Asia/Tokyo** で絶対日付へ変換する。

---

## 2. モデル向け規範テキストの所在
`src/policy/system-policy.ts` の `SYSTEM_POLICY` を参照してください（本文は本ドキュメントには重複掲載しません）。

Tips:
- 変更手順: コードの `SYSTEM_POLICY` を編集 → ビルド/再起動
- 版の確認: `SYSTEM_POLICY_REV` を参照

---

## 3. 検索判定の追加指針
- **検索を使うべき例**: 天気、為替・相場、ニュース、価格/在庫、リリースノート、セキュリティ情報（CVE 等）、サポート/EOL、組織・人事の最新、法律・規制・基準の更新、API/SDK の最新仕様。
- **検索を避ける例**: 一般的な HTTP/SQL/OS コマンドの意味、数学の定理、歴史的事実（新発見を除く）、語義・用語定義（標準化済み）。

---

## 4. 出典の扱い
- **件数**: 既定は 1–3 件（`policy.max_citations` に従う）。
- **質**: 公式サイト、一次資料、権威メディア、査読論文等を優先。寄稿サイト/生成まとめサイトは回避。
- **日付**: 公開日が明示されない場合は **アクセス日**（ISO）を付記。ニュース等では本文中に **取得日**も併記（Asia/Tokyo）。
- **重複**: 同一内容で複数 URL がある場合は最良の 1 件に絞る。

---

## 5. 出力契約（サーバ実装が依拠する仕様）
- 本文（自然文）→ 箇条書き（根拠/手順）→ **Sources:**（web_search 使用時のみ） の順。
- 検索未使用時は **Sources を出さない**。
- MCP レスポンスの `citations[]` には `{url, title?, published_at?}` を格納。
  - `url` は **URL（取得できる場合）**、または **情報源ID**（例: `oai-weather` のような `api` ソースで URL が返らない場合）を格納する。
  - `published_at` は ISO 文字列または `null`/省略。
- `used_search` は `url_citation` を 1 件以上得た、または `web_search_call` を含む場合に `true`。
- `citations[]` は `url_citation` 由来（URL）を優先する。併せて `web_search_call.action.sources`（`include` で取得）から **情報源（URL または情報源ID）** を抽出し、`url_citation` が 0 件の場合は sources 由来を採用、`url_citation` がある場合も **URL 以外の情報源ID** は併記して「検索元」を落とさない。
- `used_search=true` のとき本文に `Sources:` が欠けている場合は、サーバ側で `Sources:`（情報源 + ISO 日付）を自動付与して出力契約を満たす。

---

## 6. 日付・時刻の規則
- 出力内の相対日付は **必ず** 絶対日付（`YYYY-MM-DD`）へ変換。タイムゾーンは **Asia/Tokyo** 固定。
- 例: 「本日」→ 「2025-08-09（JST）」のように、必要に応じて括弧で補足可。

---

## 7. 失敗時の方針
- 検索や API 呼び出しで情報が確定しない場合、「確定情報が不足」「複数の見解が存在」など **不確実性を明示** した上で最良の判断を提示。
- 致命的エラー（タイムアウト等）の場合は、ユーザが次に取るべき最小手順（再実行・条件緩和等）を示す。

---

## 8. 実装上の期待（MCP サーバが前提とする動作）
- Responses API には **毎回** `tools: [{type:"web_search"}]` を渡す。
- `include: ["web_search_call.action.sources"]` を付与し、検索で参照した **情報源一覧（URL または情報源ID）** を取得できるようにする（`url_citation` が返らない場合のフォールバック、および「どこから検索したか」の補完用）。
- `instructions` は本ファイルの **2章の文面**をそのまま与える（改変禁止）。
- `policy.max_citations` 等の閾値は設定（TS defaults / YAML / ENV / CLI）で制御可能。

---

## 9. テスト観点（DoD 抜粋）
- 「HTTP 404 の意味」→ `used_search=false`、`citations=[]`。
- 「本日 YYYY-MM-DD の東京の天気」→ `used_search=true`、`citations>=1`、本文中に **情報源 + ISO 日付**（URL または情報源ID）を併記。
