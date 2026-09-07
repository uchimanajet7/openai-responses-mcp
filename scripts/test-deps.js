#!/usr/bin/env node
// npm の応答を制御して更新フローを検証し、未承認スクリプトの停止は実際の npm でも確認する。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { repoRoot } from "./deps-common.js";

const tempRoot = join(repoRoot, "_local/_ai-agent/tmp");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

function fixture(t) {
  mkdirSync(tempRoot, { recursive: true });
  const dir = mkdtempSync(join(tempRoot, "deps-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function audit(severity) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  const vulnerabilities = {};
  if (severity) {
    counts[severity] = 1;
    counts.total = 1;
    vulnerabilities.child = {
      severity, isDirect: false, range: "<1.0.1", fixAvailable: true,
      via: [{ title: "Fixture advisory", url: "https://example.invalid/advisory" }]
    };
  }
  return { metadata: { vulnerabilities: counts }, vulnerabilities };
}

const outdatedEntry = (overrides = {}) => ({
  current: "1.0.0", wanted: "1.0.1", latest: "1.0.1",
  dependent: "parent", dependedByLocation: "node_modules/parent", ...overrides
});

function runFixture(t, script, scenario = {}, { yes = "1", input = "" } = {}) {
  const dir = fixture(t);
  mkdirSync(join(dir, "scripts"));
  mkdirSync(join(dir, "bin"));
  for (const name of ["deps-common.js", "deps-check.js", "deps-update.js"]) {
    copyFileSync(join(repoRoot, "scripts", name), join(dir, "scripts", name));
  }
  const pkg = {
    name: "fixture", type: "module", dependencies: { parent: "^1.0.0" },
    devDependencies: { helper: "~1.0.0" }, allowScripts: { known: true },
    description: "Preserve user work"
  };
  for (const name of ["parent", "helper"]) {
    const path = join(dir, "node_modules", name, "package.json");
    mkdirSync(dirname(path), { recursive: true });
    writeJson(path, { name, version: "1.0.0" });
  }
  if (scenario.missing) rmSync(join(dir, "node_modules/helper"), { recursive: true });
  writeJson(join(dir, "package.json"), pkg);
  writeJson(join(dir, "package-lock.json"), { lockfileVersion: 3 });
  writeJson(join(dir, "scenario.json"), scenario);
  const before = ["package.json", "package-lock.json"].map((name) => readFileSync(join(dir, name), "utf8"));
  writeFileSync(join(dir, "bin/npm"), `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const scenario = JSON.parse(readFileSync("scenario.json", "utf8"));
const args = process.argv.slice(2);
appendFileSync("calls.jsonl", JSON.stringify(args) + "\\n");
const updated = existsSync("updated");
const output = (value, status = 0) => { console.log(JSON.stringify(value)); process.exit(status); };
if (args[0] === "outdated") {
  if (scenario.outdatedRaw !== undefined) { process.stdout.write(scenario.outdatedRaw); process.exit(1); }
  output(scenario.outdated ?? {}, scenario.outdated ? 1 : 0);
}
if (args[0] === "audit") {
  const result = (updated ? scenario.afterAudit : scenario.beforeAudit) ?? ${JSON.stringify(audit())};
  output(result, result.error || result.metadata?.vulnerabilities.high || result.metadata?.vulnerabilities.critical ? 1 : 0);
}
if (args[0] === "install-scripts" && args[1] === "ls") {
  output({ allowScripts: (updated ? scenario.afterPending : scenario.pending) ?? [] });
}
if (args[0] === "update") {
  writeFileSync("updated", "yes");
  writeFileSync("package-lock.json", JSON.stringify({ lockfileVersion: 3, updated: true }));
  process.exit(scenario.updateStatus ?? 0);
}
console.error("Unexpected npm mutation: " + args.join(" "));
process.exit(99);
`, { mode: 0o755 });
  const result = spawnSync(process.execPath, [join(dir, "scripts", script)], {
    cwd: dir, encoding: "utf8", input, timeout: 20000,
    env: { ...process.env, PATH: `${join(dir, "bin")}:${process.env.PATH}`, DEPS_UPDATE_YES: yes }
  });
  assert.ifError(result.error);
  const calls = existsSync(join(dir, "calls.jsonl"))
    ? readFileSync(join(dir, "calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse) : [];
  return {
    ...result, dir, calls, before, text: result.stdout + result.stderr,
    after: ["package.json", "package-lock.json"].map((name) => readFileSync(join(dir, name), "utf8"))
  };
}

test("check reports transitive updates and low advisories without changing package files", (t) => {
  const result = runFixture(t, "deps-check.js", { outdated: { child: outdatedEntry() }, beforeAudit: audit("low") });
  assert.equal(result.status, 1, result.text);
  assert.match(result.text, /直接依存 0 件 \/ 間接依存 1 件/);
  assert.match(result.text, /low=1/);
  assert.deepEqual(result.after, result.before);
  assert.ok(result.calls.every((args) => ["outdated", "audit", "install-scripts"].includes(args[0])));
});

test("update resolves the whole graph even when no direct package changes", (t) => {
  const result = runFixture(t, "deps-update.js", { outdated: { child: outdatedEntry() } });
  assert.equal(result.status, 0, result.text);
  assert.equal(result.after[0], result.before[0]);
  assert.equal(json(join(result.dir, "package-lock.json")).updated, true);
  const update = result.calls.find((args) => args[0] === "update");
  assert.ok(update);
  assert.ok(update.slice(1).every((arg) => arg.startsWith("--")), "No package-specific update");
  assert.ok(update.includes("--strict-allow-scripts"));
  assert.ok(update.includes("--ignore-scripts=false"));
  assert.ok(update.includes("--dangerously-allow-all-scripts=false"));
});

test("update still runs when outdated returns an empty report", (t) => {
  const result = runFixture(t, "deps-update.js");
  assert.equal(result.status, 0, result.text);
  assert.ok(result.calls.some((args) => args[0] === "update"));
});

test("duplicate-name arrays retain root latest, prefix ranges, and user fields", (t) => {
  const result = runFixture(t, "deps-update.js", { outdated: {
    parent: [outdatedEntry({ latest: "9.0.0" }), outdatedEntry({ latest: "2.0.0", dependedByLocation: "" })],
    helper: outdatedEntry({ latest: "1.1.0", dependedByLocation: "" })
  } });
  assert.equal(result.status, 0, result.text);
  const pkg = json(join(result.dir, "package.json"));
  assert.equal(pkg.dependencies.parent, "^2.0.0");
  assert.equal(pkg.devDependencies.helper, "~1.1.0");
  assert.deepEqual(pkg.allowScripts, { known: true });
  assert.equal(pkg.description, "Preserve user work");
});

test("parent-constrained latest is informational, not an installable update", (t) => {
  const result = runFixture(t, "deps-check.js", { outdated: { child: outdatedEntry({ wanted: "1.0.0", latest: "2.0.0" }) } });
  assert.equal(result.status, 0, result.text);
  assert.match(result.text, /参考: 親の制約外/);
});

test("uninstalled optional packages are not updates; installed optional packages still are", (t) => {
  const result = runFixture(t, "deps-check.js", { outdated: {
    "other-platform": outdatedEntry({ current: undefined, type: "optionalDependencies" }),
    "unused-peer": outdatedEntry({ current: undefined, type: "optionalDependencies" }),
    "installed-optional": outdatedEntry({ type: "optionalDependencies" })
  } });
  assert.equal(result.status, 1, result.text);
  assert.match(result.text, /間接依存 1 件/);
  assert.match(result.text, /installed-optional/);
  assert.doesNotMatch(result.text, /other-platform|unused-peer/);
});

for (const [name, scenario] of [
  ["network failure", { outdated: { error: { code: "ENOTFOUND", summary: "Registry unavailable" } } }],
  ["empty output", { outdatedRaw: "" }],
  ["invalid JSON", { outdatedRaw: "not JSON" }],
  ["invalid entry", { outdated: { child: {} } }],
  ["audit failure", { beforeAudit: { error: { code: "ENOTFOUND", summary: "Audit unavailable" } } }],
  ["missing audit data", { beforeAudit: {} }],
  ["missing dev dependency", { missing: true }]
]) {
  test(`${name} cannot be reported as no updates or start a mutation`, (t) => {
    const result = runFixture(t, "deps-update.js", scenario);
    assert.equal(result.status, 2, result.text);
    assert.deepEqual(result.after, result.before);
    assert.ok(!result.calls.some((args) => args[0] === "update"));
  });
}

for (const input of ["n\n", ""]) {
  test(`cancel or EOF preserves package files (input=${JSON.stringify(input)})`, (t) => {
    const result = runFixture(t, "deps-update.js", {}, { yes: "", input });
    assert.equal(result.status, 1, result.text);
    assert.deepEqual(result.after, result.before);
  });
}

test("DEPS_UPDATE_YES never approves pending scripts", (t) => {
  const result = runFixture(t, "deps-update.js", { pending: [{ name: "new-script" }] });
  assert.equal(result.status, 2, result.text);
  assert.deepEqual(result.after, result.before);
  assert.ok(!result.calls.some((args) => args[0] === "update" || args.includes("approve")));
});

for (const severity of ["low", "moderate", "high", "critical"]) {
  test(`post-update ${severity} remains visible with the correct exit status`, (t) => {
    const result = runFixture(t, "deps-update.js", { afterAudit: audit(severity) });
    assert.equal(result.status, ["high", "critical"].includes(severity) ? 3 : 0, result.text);
    assert.match(result.text, new RegExp(`${severity}=1`));
    assert.match(result.text, /依存更新処理は成功/);
  });
}

for (const scenario of [{ updateStatus: 1 }, { afterAudit: { error: { summary: "Audit unavailable" } } }]) {
  test("partial failure reports modified state instead of claiming completion", (t) => {
    const result = runFixture(t, "deps-update.js", scenario);
    assert.equal(result.status, 2, result.text);
    assert.match(result.text, /変更済みの可能性/);
    assert.doesNotMatch(result.text, /更新・監査は完了/);
  });
}

test("real npm rejects a newly introduced install script before executing it (offline)", (t) => {
  const dir = fixture(t);
  mkdirSync(join(dir, "local-package"));
  writeJson(join(dir, "local-package/package.json"), {
    name: "unreviewed-fixture", version: "1.0.0",
    scripts: { postinstall: "node -e \"require('node:fs').writeFileSync('script-ran', 'yes')\"" }
  });
  writeJson(join(dir, "package.json"), {
    name: "policy-fixture", version: "1.0.0",
    dependencies: { "unreviewed-fixture": "file:./local-package" }, allowScripts: {}
  });
  copyFileSync(join(repoRoot, ".npmrc"), join(dir, ".npmrc"));
  const result = spawnSync("npm", ["update", "--install-links", "--offline", "--no-audit", "--no-fund",
    "--ignore-scripts=false", "--dangerously-allow-all-scripts=false"], {
    cwd: dir, encoding: "utf8", timeout: 20000,
    env: { ...process.env, npm_config_cache: join(dir, "npm-cache") }
  });
  assert.ifError(result.error);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /ESTRICTALLOWSCRIPTS/);
  assert.equal(existsSync(join(dir, "node_modules/unreviewed-fixture/script-ran")), false);
  assert.equal(existsSync(join(dir, "local-package/script-ran")), false);
  assert.equal(existsSync(join(dir, "package-lock.json")), false);
});
