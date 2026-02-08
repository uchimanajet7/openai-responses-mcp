
# 再現性・再構築ガイド — `docs/reference/reproducibility.md`
最終更新: 2026-02-08 Asia/Tokyo

この文書は **openai-responses-mcp** の結果・挙動を**できる限り再現**するための運用規約と具体手順を定義します。  
「npm 固定」「安定版のみ」の方針に準拠します。

---

## 1. LLM＋検索の非決定性に関する前提と限界
再現性を阻害しうる要因を先に明示します。

- **LLM 非決定性**：OpenAI 側仕様のため、温度設定固定でも同一応答が出ない可能性がある。
- **web_search の可変性**：インデックス更新、ランク変動、記事の改稿・削除。
- **時制依存**：相対日付は JST で絶対化するが、**「本日」**は日が変わると結果も変わる。
- **API バージョン**：OpenAI SDK/Responses API のマイナー変更で注釈フォーマットが変わる可能性。

→ 本リポジトリは以下の**緩和策**で「十分に同等な再現」を狙います。

---

## 2. 強制するバージョン固定
- **Node.js**: 同一メジャーを全員で使用。推奨は v20 系。
- `package.json` の `engines.node` を利用する。例: `">=20"`。
  - 任意: 推奨は `.nvmrc` / `volta` / `asdf` 等で OS ローカル固定。*npm 固定の方針に反しない*。
- **npm**: Node 同梱を使用。依存導入は `package-lock.json` 前提で **`npm ci`** を優先する。
- **依存**: `package-lock.json` を基準にする。依存導入は **`npm ci`** を優先する。
  - 依存を更新したときは **`docs/changelog.md`** と `package-lock.json` を同時更新。

> 代表設定の例: `package.json`
```json
{
  "engines": { "node": ">=20" }
}
```

---

## 3. 事実を固定する設定スナップショット
**実効設定**を JSON で保存しておくと、後から「どの設定で動かしたか」を再現できます。

```bash
# 実効設定を保存。sources は反映元、effective は実際に使われた値。
node -e "require('fs').mkdirSync('.snapshots',{recursive:true})"
node build/index.js --show-config 2> .snapshots/effective-config.json
```

- `--config` を指定した場合はパスも `sources.yaml` に残る。
- 環境変数の値が実際に反映された場合のみ、`sources.env` に当該の環境変数名が記録される。コマンドライン引数由来は記録しない。

> 参考: スキーマと主要キーは `docs/reference/config-reference.md` を参照。

---

## 4. タイムゾーン・日付の固定
- すべての相対日付は **Asia/Tokyo** で絶対化する。サーバ実装規約。
- テスト時は OS の `TZ` を明示して起動すると観測系の差異を避けやすい：
```bash
TZ=Asia/Tokyo node build/index.js --show-config 2> ./effective.json; head -n 5 ./effective.json
```

---

## 5. スイート構成としての安定・時事テスト分離
テストケースを 2 系列に分けます。

### 5.1 API鍵不要の決定性重視 MCP レイヤ
- 期待: `initialize` と `tools/list` の応答形が安定
```bash
node -e "require('fs').mkdirSync('.snapshots',{recursive:true})"
npm run mcp:smoke:ldjson | tee .snapshots/mcp-ldjson.out
```

### 5.2 OPENAI_API_KEY が必要な API 呼び出しを含むケース
- 期待: `initialize`/`tools/list`/`tools/call(answer)` の3応答が取得できる。本文は未確定。
```bash
export OPENAI_API_KEY="sk-..."
node -e "require('fs').mkdirSync('.snapshots',{recursive:true})"
npm run mcp:smoke | tee .snapshots/mcp-content-length.out
```

> 比較は**厳密一致ではなく、構造のチェック**（キーの有無、件数、型）を重視する。

---

## 6. 比較・回帰チェックの例
```bash
# LDJSON の行数や JSON 形を比較する。本文の完全一致は求めない。
wc -l .snapshots/mcp-ldjson.out
grep -c '"jsonrpc":"2.0"' .snapshots/mcp-ldjson.out
```

---

## 7. ネットワークとプロキシの固定
- 企業ネットワーク経由時は `HTTPS_PROXY`/`HTTP_PROXY`/`NO_PROXY` を**必ず**記録。  
- 取得失敗（429/5xx）が続く再現がある場合は、**レイテンシや再試行回数**もログへ。

---

## 8. リリース・タグ運用
- 仕様変更（`spec.md`）や System Policy 改訂時は **MINOR** 以上を上げる（セマンティックバージョニング）。
- 依存更新のみは PATCH。挙動が変わる可能性があると判断したら MINOR。
- `changelog.md` に**根拠（なぜ上げたか）**を残す。

---

## 9. スナップショット・フォルダ規約
```
.snapshots/
  effective-config.json         # --show-config の出力
  baseline-404.json             # 安定知識の期待形/断片
  baseline-weather-shape.json   # 時事系の「構造」期待
```
- 実運用では CI で `.snapshots` を比較に使い、**形の崩れ**を検知する。  
- 非決定要素（本文内容など）は厳密一致を避け、形・件数・キーの存在確認に留める。

---

## 10. 依存・設定の変更フロー（提案規約）
1. ブランチで変更（依存・設定・ポリシー）。
2. `npm ci && npm run build` で再現性を確認。
3. **全スイート**（安定/時事）を実行し、`.snapshots` を更新。
4. `docs/changelog.md` を更新。
5. PR でレビュー（特に **System Policy** の改変は慎重に）。

---

## 11. 既知の再現難ポイントとワークアラウンド
- **ニュース系**: 記事の公開日時が ISO で取得できない場合がある。本文に**アクセス日**を併記してもらう（System Policy）。
- **検索結果の順序**: `policy.max_citations` を 1 に絞って**最良 1 件**にすることで差異を小さくする。
- **モデル更新**: `MODEL_ANSWER` を固定 ID に。更新を許すなら **DoD** を形チェックに限定。

---

## 12. 最低限の「再現できた」証拠の残し方
```bash
node -e "require('fs').mkdirSync('.snapshots',{recursive:true})"
```
- `node build/index.js --show-config 2> .snapshots/effective-config.json`
- `npm run mcp:smoke:ldjson > .snapshots/mcp-ldjson.out`
- 任意: `npm run mcp:smoke > .snapshots/mcp-content-length.out`。`OPENAI_API_KEY` が必要です。

以上 3 点が揃っていれば、誰でも同じ配置・同じバージョンで同等結果の再現性を高められます。
