
# 再現性・再構築ガイド — `docs/reference/reproducibility.md`
最終更新: 2026-09-07 Asia/Tokyo

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
- **Node.js**: 同一メジャーを全員で使用。推奨は v24 系。
- `package.json` の `engines.node` を利用する。例: `">=24 <25"`。
- 推奨は `.nvmrc` / `volta` / `asdf` 等で OS ローカル固定。*npm 固定の方針に反しない*。
- **npm**: 開発・CI は 11.19.0 以上を使用する。`npm --version` で確認し、古い場合は利用中の Node 環境で `npm install -g npm@latest` を実行する。`devEngines.packageManager` が開発環境の要件を検査する。CI / 配布は既存の配布方針に合わせて `npm@latest` を使用する。
- **依存導入**: `package-lock.json` 前提で **`npm ci`** を使用する。`omit-lockfile-registry-resolved=true` を保持し、取得先は利用環境の npm レジストリ設定から解決する。
- **依存**: `package-lock.json` を基準にする。依存導入は `npm run deps:install` で行う。
  - 依存更新の変更点は [変更履歴の記載方針](../spec.md#162-changelog) に従って記録する。
- **ビルド生成物**: `build/` の削除は `npm run clean:build` で行う。
- **新規の環境**: チェックアウト後に `npm ci` を実行し、続けて `npm run build` を実行する。
- **既存の開発環境**: 生成物削除、依存再導入、ビルドをまとめて行う場合は `npm run build:fresh` を使用する。

> 代表設定の例: `package.json`
```json
{
  "engines": { "node": ">=24 <25" }
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

### 5.1 API呼び出しを含まない決定性重視 MCP レイヤ
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
- 採番は [正準仕様 16.1](../spec.md#161-バージョニングsemver)、変更履歴は [16.2](../spec.md#162-changelog)、公開操作は [17.1](../spec.md#171-ブランチタグ運用) に従う。
- 本ガイドには別の採番基準を設けない。変更の実体と [過去の同種変更](../changelog.md) を確認して正準仕様の区分を適用する。

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

## 10. 依存・設定の変更フロー
1. ブランチで変更（依存・設定・ポリシー）。
2. `npm run deps:install` で開発依存を含めて導入後、`npm run deps:check` を実行する。導入済みの直接依存の latest、間接依存の wanted（親の制約内）、lockfile 全体の脆弱性、未承認スクリプトを確認する。親の制約外の latest は参考情報として表示する。別 OS 向けバイナリや未使用の optional peer など、未導入の optional 依存は更新候補に数えない。
3. `npm run deps:update` の候補表示を確認して更新を承認する。直接依存はメジャーを含め latest へ進め、既存の `^` / `~` を保持する。続けて名前指定なしの `npm update` で依存全体を再解決し、lockfile を npm に生成させる。直接依存の変更がなくてもこの処理を実行する。
4. 更新後の監査結果を確認する。開発依存を含む全重大度を表示し、High / Critical が残れば終了コード 3、Low / Moderate のみなら注意を表示して終了コード 0 とする。Low / Moderate はプロダクトでの利用箇所・成立条件・修正版の有無を踏まえて判断する。
5. `npm run build:fresh` と [依存更新後の検証](../verification.md#1-4-依存更新後の検証api-呼び出しなし) を実行する。新規環境では `npm ci` と `npm run build` でも再現できる。OpenAI API を呼ぶ検証は、API 側の挙動を確認する必要がある変更で、利用料金を伴うことを確認したうえで別途実施する。
6. 差分を PR でレビューする。リリース時の採番・変更履歴・公開は [8. リリース・タグ運用](#8-リリースタグ運用) に従う。

`deps:check` はプロジェクトのファイルを変更しない。終了コードは 0=確認事項なし、1=更新候補・脆弱性・未承認スクリプトあり、2=実行エラー。`deps:update` の終了コードは 0=更新と監査完了（High / Critical なし）、1=中止、2=実行エラー・未承認スクリプト、3=High / Critical 残存。通信失敗や不正な応答を「更新なし」「脆弱性なし」と扱わない。途中失敗時は `package.json` / `package-lock.json` / `node_modules` が変更されている可能性があるため、差分と npm のエラーを確認して原因を解消し、再実行する。自動の巻き戻しは行わない。

導入時スクリプトの承認は `package.json` の `allowScripts` で管理する。現在の `esbuild` / `fsevents` は名前単位で許可し、その将来バージョンにも適用する。`.npmrc` の `strict-allow-scripts=true` により、新たな未承認スクリプトは実行前に停止する。停止した場合は npm のエラーにあるパッケージと実行内容を確認し、必要性をレビューして `allowScripts` に許可（`true`）または拒否（`false`）を記録する。導入済みの承認漏れは `npm install-scripts ls` で確認できる。`DEPS_UPDATE_YES=1` は更新確認の省略だけに用い、新規スクリプトの自動承認には使用しない。

CI とタグによる配布では `npm audit --package-lock-only --include=dev --include=optional --include=peer --audit-level=high` を実行する。この閾値は停止条件であり、Low / Moderate の表示を抑制しない。既存の Dependabot による npm / GitHub Actions の週次更新は継続する。security updates の有効化は GitHub リポジトリ設定で確認する。

根拠: [npm update](https://docs.npmjs.com/cli/v11/commands/npm-update/)、[npm audit](https://docs.npmjs.com/cli/v11/commands/npm-audit/)、[install-script policy](https://docs.npmjs.com/cli/v11/using-npm/config/#strict-allow-scripts)、[devEngines](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#devengines)。npm 自身が公開した [npm 12 の導入時セキュリティ変更](https://github.blog/changelog/2026-07-08-npm-install-time-security-and-gat-bypass2fa-deprecation/) と整合させる。

---

## 11. 既知の再現難ポイントとワークアラウンド
- **ニュース系**: 記事の公開日時が ISO で取得できない場合がある。本文に**アクセス日**を併記してもらう（System Policy）。
- **検索結果の順序**: `policy.max_citations` を 1 に絞って**最良 1 件**にすることで差異を小さくする。
- **モデル更新**: `MODEL_ANSWER` は `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna` の明示IDに固定する。`gpt-5.6` エイリアスを使う場合は、MCP 応答の `model`（API の `response.model`）も証跡として保存する。更新を許すなら **DoD** を形チェックに限定。

---

## 12. 最低限の「再現できた」証拠の残し方
```bash
node -e "require('fs').mkdirSync('.snapshots',{recursive:true})"
```
- `node build/index.js --show-config 2> .snapshots/effective-config.json`
- `npm run mcp:smoke:ldjson > .snapshots/mcp-ldjson.out`
- `npm run mcp:smoke > .snapshots/mcp-content-length.out`。`OPENAI_API_KEY` が必要です。

以上 3 点が揃っていれば、誰でも同じ配置・同じバージョンで同等結果の再現性を高められます。
