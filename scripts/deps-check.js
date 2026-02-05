#!/usr/bin/env node
// 依存パッケージの更新要否を確認する（更新はしない）
//
// 使い方:
//   node scripts/deps-check.js
//
// 終了コード:
//   0: 更新不要
//   1: 更新が必要（outdatedあり）
//   2: 実行エラー

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const NPM = "npm";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = resolve(repoRoot, "package.json");

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
  lines.push(`[deps-check] 更新候補: ${total} 件`);

  if (total === 0) {
    lines.push("[deps-check] OK: 更新不要（outdatedなし）");
    return { text: lines.join("\n"), hasUpdates: false };
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
    lines.push("[deps-check] 注意: MAJOR 更新は破壊的変更の可能性があります。");
  }

  lines.push("");
  lines.push("[deps-check] UPDATE NEEDED: 上記の更新候補があります。");

  return { text: lines.join("\n"), hasUpdates: true };
}

function main() {
  try {
    const outdated = runNpmOutdatedJson();
    const directNames = readDirectDependencyNames();
    const { text, hasUpdates } = buildReport(outdated, directNames);
    console.log(text);
    process.exit(hasUpdates ? 1 : 0);
  } catch (e) {
    console.error(`[deps-check] ERROR: ${e?.message ?? e}`);
    process.exit(2);
  }
}

main();
