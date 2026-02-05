import { homedir } from "node:os";
import { join } from "node:path";

export function defaultConfigPath(): string {
  const home = homedir();
  return join(home, ".config", "openai-responses-mcp", "config.yaml");
}

export function resolveConfigPath(cliPath?: string): string | undefined {
  if (cliPath && cliPath.trim()) return cliPath;
  return defaultConfigPath();
}
