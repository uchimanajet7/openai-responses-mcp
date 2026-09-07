// deps:check / deps:update が共有する npm の照会・表示処理。
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const packageJsonPath = resolve(repoRoot, "package.json");
export const dependencySections = ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"];
export const includeDependencies = ["--include=dev", "--include=optional", "--include=peer"];

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function runNpmJson(args, allowedStatuses = [0]) {
  const result = spawnSync("npm", [...args, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"]
  });
  const command = `npm ${args.join(" ")}`;
  const fail = (message) => new Error(`${command}: ${message}${result.stderr?.trim() ? `\n${result.stderr.trim()}` : ""}`);
  if (result.error || !allowedStatuses.includes(result.status)) {
    throw fail(result.error?.message ?? `failed (code=${result.status}, signal=${result.signal ?? "none"})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw fail("JSON を取得できませんでした。確認は未完了です。");
  }
  if (!isObject(parsed) || parsed.error) {
    throw fail(parsed?.error?.summary ?? parsed?.error?.message ?? "不正な応答です。");
  }
  if (result.stderr?.trim()) console.error(result.stderr.trim());
  return parsed;
}

function classifyBump(current, latest) {
  const parts = (version) => /^(\d+)\.(\d+)\.(\d+)/.exec(version ?? "")?.slice(1);
  const before = parts(current);
  const after = parts(latest);
  if (!before || !after) return "UNKNOWN";
  return ["MAJOR", "MINOR", "PATCH"].find((_, i) => before[i] !== after[i]) ?? "RANGE";
}

export function reportUpdates(label) {
  const pkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  // outdated / install-scripts ls は導入済みツリーを読む。未導入を「更新なし」にしない。
  const required = { ...pkg.dependencies, ...pkg.devDependencies };
  for (const name of Object.keys(required)) {
    if (pkg.optionalDependencies?.[name]) continue;
    if (!existsSync(resolve(repoRoot, "node_modules", name, "package.json"))) {
      throw new Error(`${name} が未導入です。先に npm run deps:install を実行してください。`);
    }
  }
  const outdated = runNpmJson(["outdated", "--all", "--long", ...includeDependencies], [0, 1]);
  const directNames = new Set(dependencySections.flatMap((section) => Object.keys(pkg[section] ?? {})));
  // npm outdated は別 OS 用バイナリや未使用の optional peer も返す場合がある。
  const entries = Object.entries(outdated).flatMap(([name, value]) =>
    (Array.isArray(value) ? value : [value]).map((info) => {
      if (!isObject(info) || typeof info.latest !== "string" || typeof info.wanted !== "string" ||
          typeof info.dependedByLocation !== "string") {
        throw new Error(`npm outdated: ${name} の応答が不正です。`);
      }
      return { name, ...info, direct: directNames.has(name) && info.dependedByLocation === "" };
    })
  ).filter((entry) => entry.current !== undefined || entry.type !== "optionalDependencies")
    .sort((a, b) => a.name.localeCompare(b.name));
  const direct = entries.filter((entry) => entry.direct);
  const transitive = entries.filter((entry) => !entry.direct && entry.current !== entry.wanted);
  const constrained = entries.filter((entry) => !entry.direct && entry.current === entry.wanted && entry.wanted !== entry.latest);
  console.log(`[${label}] 更新候補: 直接依存 ${direct.length} 件 / 間接依存 ${transitive.length} 件`);
  for (const entry of direct) {
    console.log(`- [${classifyBump(entry.current, entry.latest)}] ${entry.name}: ${entry.current ?? "未導入"} -> ${entry.latest} (wanted: ${entry.wanted})`);
  }
  if (direct.some((entry) => classifyBump(entry.current, entry.latest) === "MAJOR")) {
    console.log(`[${label}] 注意: MAJOR 更新は破壊的変更の可能性があります。`);
  }
  for (const entry of transitive) {
    console.log(`- [間接依存] ${entry.name}: ${entry.current ?? "未導入"} -> ${entry.wanted} (親: ${entry.dependent}, latest: ${entry.latest})`);
  }
  for (const entry of constrained) {
    console.log(`- [参考: 親の制約外] ${entry.name}: ${entry.current} (親: ${entry.dependent}, latest: ${entry.latest})`);
  }
  return { direct, hasUpdates: direct.length + transitive.length > 0 };
}

export function reportAudit(label) {
  const audit = runNpmJson(["audit", "--package-lock-only", ...includeDependencies, "--audit-level=high"], [0, 1]);
  const counts = audit.metadata?.vulnerabilities;
  const levels = ["info", "low", "moderate", "high", "critical"];
  if (!isObject(audit.vulnerabilities) || !isObject(counts) ||
      [...levels, "total"].some((level) => !Number.isInteger(counts[level]) || counts[level] < 0)) {
    throw new Error("npm audit: 監査結果を取得できませんでした。脆弱性の確認は未完了です。");
  }
  console.log(`[${label}] 監査: ${levels.map((level) => `${level}=${counts[level]}`).join(", ")}`);
  for (const [name, entry] of Object.entries(audit.vulnerabilities)) {
    console.log(`- ${name}: ${entry.severity} (${entry.isDirect ? "直接依存" : "間接依存"}, ${entry.range})`);
    for (const via of entry.via ?? []) {
      console.log(typeof via === "string" ? `  影響元: ${via}` : `  ${via.title}: ${via.url}`);
    }
    console.log(`  ${entry.fixAvailable ? "npm が修正候補を報告しています。" : "npm による修正候補はありません。"}`);
  }
  return { total: counts.total, highOrCritical: counts.high + counts.critical > 0 };
}

export function reportScriptApprovals(label) {
  const result = runNpmJson(["install-scripts", "ls"]);
  if (!Array.isArray(result.allowScripts) || result.allowScripts.some((entry) => typeof entry?.name !== "string")) {
    throw new Error("npm install-scripts ls: 承認状況の応答が不正です。");
  }
  console.log(`[${label}] 未承認の導入時スクリプト: ${result.allowScripts.length} 件`);
  for (const entry of result.allowScripts) console.log(`- ${entry.name}`);
  if (result.allowScripts.length > 0) {
    console.log(`[${label}] npm install-scripts ls で確認し、実行内容をレビューして allowScripts の許可・拒否を判断してください。自動承認はしません。`);
  }
  return result.allowScripts.length;
}
