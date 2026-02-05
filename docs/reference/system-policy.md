
# System Policy の参照先
最終更新: 2026-01-14 Asia/Tokyo

System Policy の参照先は `src/policy/system-policy.ts`。Responses API の `instructions` には `SYSTEM_POLICY` をそのまま与える。

- 参照先: `src/policy/system-policy.ts`
  - `export const SYSTEM_POLICY` 本文
  - `export const SYSTEM_POLICY_REV` 改定版識別

このドキュメントは参照ガイドです。本文の複製は保持しません。内容変更は必ず `src/policy/system-policy.ts` を更新してください。

---

## 1. 運用原則
- 本サーバは MCP ツール `answer` / `answer_detailed` / `answer_quick` のバックエンドであり、**OpenAI Responses API** を用いる。
- 毎リクエストで `tools: [{"type":"web_search"}]` を **常時許可**する。検索を実行するかどうかは**モデルが判断**する。
- 返却は本文・検索使用有無・出典・使用モデルを構造化して返す。出力契約は後述。
- 時制/相対日付は **Asia/Tokyo** で絶対日付へ変換する。

---

## 2. モデル向け規範テキストの所在
`src/policy/system-policy.ts` の `SYSTEM_POLICY` を参照してください。本ドキュメントには本文を重複掲載しません。

Tips:
- 変更手順: コードの `SYSTEM_POLICY` を編集 → ビルド/再起動
- 版の確認: `SYSTEM_POLICY_REV` を参照

---

## 3. 検索判定の追加指針
- **検索を使うべき例**: 天気、為替・相場、ニュース、価格/在庫、リリースノート、CVE などのセキュリティ情報、サポート/EOL、組織・人事の最新、法律・規制・基準の更新、API/SDK の最新仕様。
- **検索を避ける例**: 一般的な HTTP/SQL/OS コマンドの意味、数学の定理、新発見がない限りの歴史的事実、標準化済みの語義・用語定義。

---

## 4. 出典の扱い
- **件数**: 既定は 1–3 件。`policy.max_citations` に従う。
- **質**: 公式サイト、一次資料、権威メディア、査読論文等を優先。寄稿サイト/生成まとめサイトは回避。
- **日付**: 公開日が明示されない場合は **アクセス日**を ISO 形式で付記。ニュース等では本文中に **取得日**も Asia/Tokyo で併記。
- **重複**: 同一内容で複数 URL がある場合は最良の 1 件に絞る。

---

## 5. サーバ実装が依拠する出力契約
- 本文は `answer` に格納する。
- `answer`（本文）→ 箇条書きで根拠と手順→ **Sources:** の順。Sources は web_search 使用時のみ。
- 検索未使用時は **Sources を出さない**。
- `answer` の JSON の `citations[]` には `{url, title?, published_at}` を格納。
  - `url` は URL を格納する。URL が返らない場合は **情報源ID** を格納する。例: `api` ソースの `oai-weather`。
- `published_at` は ISO 形式の日付文字列。公開日が取れない場合はアクセス日。
- `used_search` は `answer` の JSON で、`url_citation` を 1 件以上得た、または `web_search_call` を含む場合に `true`。
- `citations[]` は URL の `url_citation` を優先する。`include` で `web_search_call.action.sources` を取得し、**情報源** を URL または情報源ID として抽出する。`url_citation` が 0 件なら sources 由来を採用し、`url_citation` がある場合も **URL 以外の情報源ID** は併記して「検索元」を落とさない。
- `used_search=true` のとき `answer` の本文に `Sources:` が欠けている場合は、サーバ側で `Sources:` を情報源と ISO 日付付きで自動付与して出力契約を満たす。

---

## 6. 日付・時刻の規則
- 出力内の相対日付は **必ず** `YYYY-MM-DD` 形式の絶対日付へ変換。タイムゾーンは **Asia/Tokyo** 固定。
- 例: 「本日」→ 「2025-08-09 JST」。

---

## 7. 失敗時の方針
- 検索や API 呼び出しで情報が確定しない場合、「確定情報が不足」「複数の見解が存在」など **不確実性を明示** した上で最良の判断を提示。
- 致命的エラーの場合は、タイムアウトなどの状況を明示し、ユーザが次に取るべき最小手順として再実行や条件緩和などを示す。

---

## 8. MCP サーバが前提とする実装上の期待
- Responses API には **毎回** `tools: [{type:"web_search"}]` を渡す。
- `include: ["web_search_call.action.sources"]` を付与し、検索で参照した **情報源一覧** を URL または情報源ID として取得できるようにする。`url_citation` が返らない場合のフォールバックと、「どこから検索したか」の補完に使う。
- `instructions` には `src/policy/system-policy.ts` の `SYSTEM_POLICY` を**そのまま**与える。改変禁止。
- `policy.max_citations` などの閾値は TS defaults と YAML と ENV の設定で制御できる。

---

## 9. DoD 抜粋のテスト観点
- 「HTTP 404 の意味」→ `answer` の JSON で `used_search=false`、`citations=[]`。
- 「本日 YYYY-MM-DD の東京の天気」→ `answer` の JSON で `used_search=true`、`citations>=1`、本文中に **情報源 + ISO 日付** を URL または情報源ID として併記。
