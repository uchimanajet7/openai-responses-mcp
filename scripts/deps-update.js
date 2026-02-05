#!/usr/bin/env node
// 依存パッケージを最新へ更新する（メジャー更新も含む）
//
// 使い方:
//   node scripts/deps-update.js
//
// 確認スキップ（自動化用）:
//   DEPS_UPDATE_YES=1 node scripts/deps-update.js
//
// 終了コード:
//   0: 更新実施（または更新不要）
//   1: ユーザーが中止
//   2: 実行エラー

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import readline from "node:readline";

const NPM = "npm";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = resolve(repoRoot, "package.json");

function isTruthy(value) {
  if (!value) return false;
  const v = String(value).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "y";
}

function parseSemver(version) {
  if (typeof version !== "string") return null;
  const match = version.trim().match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function classifyBump(current, latest) {
  const c = parseSemver(current);
  const l = parseSemver(latest);
  if (!c || !l) return "unknown";
  if (c.major !== l.major) return "major";
  if (c.minor !== l.minor) return "minor";
  if (c.patch !== l.patch) return "patch";
  return current?.trim?.() === latest?.trim?.() ? "none" : "patch";
}

function runNpmOutdatedJson() {
  const result = spawnSync(NPM, ["outdated", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

  // npm outdated は「更新あり」の場合に exit code=1 になるため許容する
  if (result.status !== 0 && result.status !== 1) {
    const stderr = result.stderr?.trim?.() ?? "";
    const hint = stderr ? `\n[npm stderr]\n${stderr}` : "";
    throw new Error(`npm outdated failed (code=${result.status ?? "null"})${hint}`);
  }

  const stdout = (result.stdout ?? "").trim();
  if (!stdout) return {};

  try {
    const parsed = JSON.parse(stdout);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    const stderr = result.stderr?.trim?.() ?? "";
    const hint = stderr ? `\n[npm stderr]\n${stderr}` : "";
    throw new Error(`npm outdated returned non-JSON output.${hint}\n[stdout]\n${stdout}`);
  }
}

function readDirectDependencyNames() {
  const raw = readFileSync(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw);
  const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  const names = new Set();
  for (const section of sections) {
    const table = pkg?.[section];
    if (!table || typeof table !== "object") continue;
    for (const name of Object.keys(table)) names.add(name);
  }
  return names;
}

function buildReport(outdatedByName, directNames) {
  const entries = Object.entries(outdatedByName).map(([name, info]) => {
    const current = info?.current ?? "";
    const wanted = info?.wanted ?? "";
    const latest = info?.latest ?? "";
    const type = info?.type ?? "";
    const bump = classifyBump(current, latest);
    return { name, current, wanted, latest, type, bump };
  }).filter((e) => directNames.has(e.name));

  entries.sort((a, b) => a.name.localeCompare(b.name));

  const groups = {
    major: entries.filter((e) => e.bump === "major"),
    minor: entries.filter((e) => e.bump === "minor"),
    patch: entries.filter((e) => e.bump === "patch"),
    unknown: entries.filter((e) => e.bump === "unknown")
  };

  const lines = [];
  const total = entries.length;
  lines.push(`[deps-update] 更新候補: ${total} 件`);

  if (total === 0) {
    lines.push("[deps-update] OK: 更新不要（outdatedなし）");
    return { text: lines.join("\n"), hasUpdates: false, groups, entries };
  }

  const pushGroup = (label, list) => {
    if (list.length === 0) return;
    lines.push("");
    lines.push(`[${label}] ${list.length} 件`);
    for (const e of list) {
      const wantedPart = e.wanted ? ` (wanted: ${e.wanted})` : "";
      const typePart = e.type ? ` [${e.type}]` : "";
      lines.push(`- ${e.name}: ${e.current} -> ${e.latest}${wantedPart}${typePart}`);
    }
  };

  pushGroup("MAJOR", groups.major);
  pushGroup("MINOR", groups.minor);
  pushGroup("PATCH", groups.patch);
  pushGroup("UNKNOWN", groups.unknown);

  if (groups.major.length > 0) {
    lines.push("");
    lines.push("[deps-update] 注意: MAJOR 更新は破壊的変更の可能性があります。");
  }

  return { text: lines.join("\n"), hasUpdates: true, groups, entries };
}

function makeNewSpec(oldSpec, latestVersion) {
  const s = typeof oldSpec === "string" ? oldSpec.trim() : "";
  if (s.startsWith("^")) return `^${latestVersion}`;
  if (s.startsWith("~")) return `~${latestVersion}`;
  return `${latestVersion}`;
}

function updatePackageJson(entries) {
  const raw = readFileSync(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw);

  const sections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
  const changes = [];

  for (const e of entries) {
    for (const section of sections) {
      const table = pkg?.[section];
      if (!table || typeof table !== "object") continue;
      if (!(e.name in table)) continue;

      const oldSpec = table[e.name];
      const newSpec = makeNewSpec(oldSpec, e.latest);
      if (oldSpec === newSpec) continue;

      table[e.name] = newSpec;
      changes.push({ name: e.name, section, oldSpec, newSpec });
    }
  }

  if (changes.length === 0) return { changed: false, changes: [] };

  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
  return { changed: true, changes };
}

async function confirmOrAbort() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question("[deps-update] 更新を実行しますか？ (y/N): ", resolve));
  rl.close();
  return String(answer).trim().toLowerCase() === "y" || String(answer).trim().toLowerCase() === "yes";
}

function runNpmInstall() {
  const result = spawnSync(NPM, ["install"], { cwd: repoRoot, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`npm install failed (code=${result.status ?? "null"})`);
  }
}

async function main() {
  try {
    const outdated = runNpmOutdatedJson();
    const directNames = readDirectDependencyNames();
    const report = buildReport(outdated, directNames);
    console.log(report.text);

    if (!report.hasUpdates) {
      process.exit(0);
    }

    const assumeYes = isTruthy(process.env.DEPS_UPDATE_YES);
    const ok = assumeYes ? true : await confirmOrAbort();
    if (!ok) {
      console.log("[deps-update] 中止しました。");
      process.exit(1);
    }

    const { changed, changes } = updatePackageJson(report.entries);
    if (!changed) {
      console.log("[deps-update] package.json は更新不要でした（想定外）。");
      process.exit(0);
    }

    console.log(`[deps-update] package.json 更新: ${changes.length} 件`);
    for (const c of changes) {
      console.log(`- ${c.name} (${c.section}): ${c.oldSpec} -> ${c.newSpec}`);
    }

    console.log("[deps-update] npm install を実行して package-lock.json を更新します。");
    runNpmInstall();

    console.log("[deps-update] 完了しました。");
    process.exit(0);
  } catch (e) {
    console.error(`[deps-update] ERROR: ${e?.message ?? e}`);
    process.exit(2);
  }
}

await main();
