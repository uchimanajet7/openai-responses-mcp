#!/usr/bin/env node
// 直接依存の latest と、親の制約内の間接依存を更新する。
// DEPS_UPDATE_YES=1 は更新確認だけを省略し、導入時スクリプトは自動承認しない。
// 終了コード: 0=更新・監査完了、1=中止、2=実行エラー、3=High/Critical 残存
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import readline from "node:readline";
import {
  repoRoot, packageJsonPath, dependencySections, includeDependencies,
  reportUpdates, reportAudit, reportScriptApprovals
} from "./deps-common.js";

function updatePackageJson(entries) {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const changes = [];
  for (const entry of entries) {
    for (const section of dependencySections) {
      if (!Object.hasOwn(pkg[section] ?? {}, entry.name)) continue;
      const oldSpec = pkg[section][entry.name];
      const match = /^([~^]?)(\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?)$/.exec(oldSpec);
      if (!match || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\+[\w.-]+)?$/.test(entry.latest)) {
        throw new Error(`${entry.name}: 対応外の依存指定です (${oldSpec} -> ${entry.latest})。package.json は変更していません。`);
      }
      const newSpec = `${match[1]}${entry.latest}`;
      if (oldSpec === newSpec) continue;
      pkg[section][entry.name] = newSpec;
      changes.push(`${entry.name} (${section}): ${oldSpec} -> ${newSpec}`);
    }
  }
  if (changes.length > 0) writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  console.log(`[deps-update] package.json 更新: ${changes.length} 件`);
  for (const change of changes) console.log(`- ${change}`);
}

async function confirmUpdate() {
  if (["1", "true", "yes", "y"].includes(process.env.DEPS_UPDATE_YES?.trim().toLowerCase())) return true;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.once("close", () => resolve(""));
    rl.question("[deps-update] 依存全体の更新を実行しますか？ (y/N): ", resolve);
  });
  rl.close();
  return ["y", "yes"].includes(answer.trim().toLowerCase());
}

let updateStarted = false;
try {
  const report = reportUpdates("deps-update");
  reportAudit("deps-update: 更新前");
  if (reportScriptApprovals("deps-update") > 0) {
    throw new Error("未承認の導入時スクリプトがあります。更新は開始していません。");
  }
  if (!report.hasUpdates) {
    console.log("[deps-update] 導入済み依存の更新候補はありません。確認後、lockfile を含め依存全体を再解決します。");
  }
  if (!await confirmUpdate()) {
    console.log("[deps-update] 中止しました。ファイルは変更していません。");
    process.exitCode = 1;
  } else {
    updateStarted = true;
    updatePackageJson(report.direct);
    console.log("[deps-update] npm update で依存全体と package-lock.json を更新します。");
    // 更新と監査の成否を分ける。承認ポリシーを緩める環境設定もここでは使用しない。
    const result = spawnSync("npm", [
      "update", ...includeDependencies, "--save=false", "--no-audit",
      "--strict-allow-scripts", "--ignore-scripts=false", "--dangerously-allow-all-scripts=false"
    ], { cwd: repoRoot, stdio: "inherit" });
    if (result.error || result.status !== 0) {
      throw new Error(result.error?.message ?? `npm update failed (code=${result.status}, signal=${result.signal ?? "none"})。npm のエラー内容を確認してください。`);
    }
    console.log("[deps-update] 依存更新処理は成功しました。更新後の承認状況と監査を確認します。");
    if (reportScriptApprovals("deps-update") > 0) throw new Error("更新後の依存に未承認スクリプトが残っています。");
    const audit = reportAudit("deps-update: 更新後");
    if (audit.highOrCritical) {
      console.error("[deps-update] High / Critical が残っています。更新は完了しましたが、監査基準を満たしていません。");
      process.exitCode = 3;
    } else {
      console.log(audit.total > 0
        ? "[deps-update] 更新・監査は完了しました。残存する脆弱性の影響と対応はメンテナの判断が必要です。"
        : "[deps-update] 更新・監査は完了しました。既知の脆弱性はありません。");
      process.exitCode = 0;
    }
    console.log("[deps-update] ビルド・テストは未実行です。docs/verification.md の依存更新後の検証を実行してください。");
  }
} catch (error) {
  console.error(`[deps-update] ERROR: ${error.message}`);
  if (updateStarted) {
    console.error("[deps-update] 処理は完了していません。package.json / package-lock.json / node_modules が変更済みの可能性があります。差分と npm のエラーを確認してください。自動では巻き戻しません。");
  }
  process.exitCode = 2;
}
