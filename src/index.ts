#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { loadConfig } from "./config/load.js";
import { resolveConfigPath } from "./config/paths.js";
import { startServer } from "./mcp/server.js";
import { setDebug } from "./debug/state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, "..", "package.json"), "utf8"));

function ts(): string { return new Date().toISOString(); }
function logInfo(msg: string): void { console.error(`[mcp] ${ts()} INFO ${msg}`); }
function logError(msg: string): void { console.error(`[mcp] ${ts()} ERROR ${msg}`); }

type Opts = {
  help?: boolean;
  version?: boolean;
  showConfig?: boolean;
  stdio?: boolean;
  configPath?: string;
  // --debug [<path>] に対応
  debug?: boolean;
  debugPath?: string;
};

function parseArgs(argv: string[]): Opts {
  const o: Opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") o.help = true;
    else if (a === "--version" || a === "-v") o.version = true;
    else if (a === "--show-config") o.showConfig = true;
    else if (a === "--stdio") o.stdio = true;
    else if (a === "--config") { o.configPath = argv[++i]; }
    else if (a.startsWith("--config=")) { o.configPath = a.split("=",2)[1]; }
    else if (a === "--debug") {
      // --debug に続くトークンがパスなら取り込む。先頭が'-'以外の場合。
      const next = argv[i+1];
      if (next && !next.startsWith("-")) { o.debug = true; o.debugPath = next; i++; }
      else { o.debug = true; }
    }
    else if (a.startsWith("--debug=")) {
      const v = a.split("=",2)[1];
      if (v && v.length > 0) { o.debug = true; o.debugPath = v; } else { o.debug = true; }
    }
  }
  return o;
}

function usage(): void {
  console.log(`openai-responses-mcp
Usage:
  openai-responses-mcp --help
  openai-responses-mcp --version
  openai-responses-mcp --show-config [--config <path>]
  openai-responses-mcp --stdio   # Start MCP stdio server

Notes:
  - Priority: ENV > YAML > TS defaults
  - Default YAML path: ~/.config/openai-responses-mcp/config.yaml
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.version) {
    console.log(pkg.version);
    process.exit(0);
  }
  if (args.help || process.argv.length <= 2) {
    usage();
    process.exit(0);
  }

  const loaded = loadConfig({
    cli: { configPath: resolveConfigPath(args.configPath) },
    env: process.env
  });

  // --show-config の扱い：
  // - 単独指定時: stderr にJSON出力し、0終了
  // - --stdio と併用時: stderr にJSON出力し、そのままサーバ継続。stdout は汚さない。
  let showConfigPrinted = false;
  if (args.showConfig) {
    try {
      const out = {
        version: pkg.version,
        sources: loaded.sources,
        effective: loaded.effective
      };
      // stdout を汚さないため、stderr に出力
      console.error(JSON.stringify(out, null, 2));
      showConfigPrinted = true;
    } catch (e: any) {
      logError(`failed to render config: ${e?.message ?? e}`);
    }
    if (!args.stdio) {
      process.exit(0);
    }
  }
  if (args.stdio) {
    // デバッグ有効化。優先度は CLI > ENV > YAML。
    const yamlDbg = (loaded.effective.server as any)?.debug ? true : false;
    const yamlDbgFile = (loaded.effective.server as any)?.debug_file || null;

    // 1) CLI を最優先で反映。仕様は CLI/ENV/YAML 同義。
    if (args.debug) {
      loaded.effective.server.debug = true;
      if (args.debugPath) loaded.effective.server.debug_file = args.debugPath;
      // ENV も同期する。transport層のデバッグ判定で利用するため。
      process.env.DEBUG = args.debugPath ? args.debugPath : '1';
    }

    // 2) ENV の DEBUG が存在し、CLIで未指定なら反映
    if (!args.debug && process.env.DEBUG && process.env.DEBUG.length > 0) {
      const v = String(process.env.DEBUG);
      loaded.effective.server.debug = true;
      if (v !== '1' && v.toLowerCase() !== 'true') loaded.effective.server.debug_file = v;
    }

    // 3) YAML。最後に不足分を補完する。
    if (!loaded.effective.server.debug && yamlDbg) loaded.effective.server.debug = true;
    if (!loaded.effective.server.debug_file && yamlDbgFile) loaded.effective.server.debug_file = yamlDbgFile;

    const dbgEnabled = !!loaded.effective.server.debug;
    const dbgFile = (loaded.effective.server as any).debug_file || null;

    // 単一判定へ反映する。以降は isDebug() を参照する。
    setDebug(dbgEnabled, dbgFile);

    // デバッグ時は起動情報を stderr に出す。GUIクライアントの切り分け用。
    if (dbgEnabled) {
      logInfo(`starting stdio server pid=${process.pid}`);
      logInfo(`argv=${JSON.stringify(process.argv)}`);
      logInfo(`cwd=${process.cwd()}`);
      logInfo(`node=${process.version}`);
    }
    if (showConfigPrinted) {
      logInfo(`show-config printed to stderr (continuing)`);
    }
    process.on("uncaughtException", (e) => logError(`uncaughtException ${e}`));
    process.on("unhandledRejection", (e: any) => logError(`unhandledRejection ${e?.message ?? e}`));
    startServer(loaded.effective);
    return; // keep process alive
  }

  console.error("Unknown options. Try --help");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
