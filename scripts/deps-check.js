#!/usr/bin/env node
// 更新候補・脆弱性・導入時スクリプトの承認漏れを確認する（プロジェクトのファイルは変更しない）。
// 終了コード: 0=確認事項なし、1=確認事項あり、2=実行エラー
import { reportUpdates, reportAudit, reportScriptApprovals } from "./deps-common.js";

try {
  const { hasUpdates } = reportUpdates("deps-check");
  const audit = reportAudit("deps-check");
  const unreviewed = reportScriptApprovals("deps-check");
  const needsReview = hasUpdates || audit.total > 0 || unreviewed > 0;
  console.log(needsReview ? "[deps-check] 確認事項があります。上記の結果を確認してください。" : "[deps-check] OK: 更新候補・既知の脆弱性・未承認スクリプトはありません。");
  process.exitCode = needsReview ? 1 : 0;
} catch (error) {
  console.error(`[deps-check] ERROR: ${error.message}`);
  process.exitCode = 2;
}
