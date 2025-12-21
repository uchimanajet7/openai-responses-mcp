# openai-responses-mcp

<div align="center">
  <p><a href="./README.md">日本語</a></p>
</div>

A lightweight MCP server that uses the OpenAI Responses API as its inference core.  
`web_search` is always permitted; whether to actually search is decided autonomously by the model. It is used over stdio from MCP clients such as Claude Code and Claude Desktop.

Important: The canonical specification is `docs/spec.md`. See that file for details.

---

## Repository Structure
- `src/`                         : TypeScript sources
- `scripts/`                     : Verification/utility scripts (e.g., `mcp-smoke*`, `clean.js`)
- `config/`
  - `config.yaml.example`        : Sample configuration
  - `policy.md.example`          : Sample external System Policy
- `docs/`                        : Canonical spec/reference/verification steps
  - `spec.md`                    : Canonical specification
  - `reference/`                 : Configuration, setup, and integration references
  - `verification.md`            : E2E verification procedure
- `README.md`                    : Project overview and quick start
- `LICENSE`                      : License
- `package.json`, `package-lock.json` : npm settings and locked dependencies
- `tsconfig.json`                : TypeScript configuration
- `.gitignore`                   : Git ignore settings

---

## Highlights (Overview)
- Responses API compliant (official JS SDK `openai`)
- Search is delegated to the model (always permit `web_search`)
- Structured output (body, `used_search`, `citations[]`, `model`)
  - `citations[]` returns **sources** (URLs, or source IDs such as `oai-weather` when no public URL is provided)
- System Policy as code SSOT (`src/policy/system-policy.ts`)
- MCP stdio implementation (`initialize`/`tools/list`/`tools/call`)

## Requirements
- Node.js v20 or later (recommended: v24)
- npm (bundled with Node)
- OpenAI API key (provided via environment variable)

---

## Minimal Setup (boot with only required settings)
- Required setting: just the `OPENAI_API_KEY` environment variable (no YAML needed)
- Example startup (npx):
  - `export OPENAI_API_KEY="sk-..." && npx openai-responses-mcp@latest --stdio`

You can add YAML later (default path: macOS/Linux `~/.config/openai-responses-mcp/config.yaml`, Windows `%APPDATA%\openai-responses-mcp\config.yaml`).

---

## For Users (use as an MCP)
Use this from an MCP client.

### 1) Register with Claude Code
- Add the following entry to `~/.claude.json`:

```json
{
  "mcpServers": {
    "openai-responses": {
      "command": "npx",
      "args": ["openai-responses-mcp@latest", "--stdio"],
      "env": { "OPENAI_API_KEY": "sk-..." }
    }
  }
}
```

- Or run via the Claude Code CLI:

```sh
claude mcp add -s user -t stdio openai-responses -e OPENAI_API_KEY=sk-xxxx -- npx openai-responses-mcp@latest --stdio
```

### 2) Register with OpenAI Codex
- Add the following entry to `~/.codex/config.toml`:

```toml
[mcp_servers.openai-responses]
command = "npx"
args = ["-y", "openai-responses-mcp@latest", "--stdio"]
env = { OPENAI_API_KEY = "sk-xxxx" }
```

### 3) Example guidance for CLAUDE.md and AGENTS.md
```markdown
### Problem-Solving Policy

When you encounter issues or implementation difficulties during development:

1. **Always consult the openai-responses MCP**  
   - Consultation is mandatory and top priority  
   - Never proceed with implementation based on unilateral judgment  

2. **Ask all questions in English**  
   - Write every question to openai-responses MCP in English  

3. **Research alternatives and the latest best practices**  
   - Leverage openai-responses MCP to gather solutions and current best practices  

4. **Consider multiple solution approaches**  
   - Do not jump to one method; compare multiple options before deciding the course  

5. **Document the solution**  
   - After resolving the problem, record steps and methods to enable quick response to recurrences  
```

### 4) Run immediately with npx
```bash
export OPENAI_API_KEY="sk-..." 
npx openai-responses-mcp@latest --stdio --debug ./_debug.log --config ~/.config/openai-responses-mcp/config.yaml
```

### 5) Configuration (YAML optional)
Default path: macOS/Linux `~/.config/openai-responses-mcp/config.yaml`, Windows `%APPDATA%\openai-responses-mcp\config.yaml`

Minimal example:

```yaml
model_profiles:
  answer:
    model: gpt-5.2
    reasoning_effort: medium
    verbosity: medium

request:
  timeout_ms: 300000
  max_retries: 3
```
Sample: `config/config.yaml.example`

External policy (optional):

```yaml
policy:
  system:
    source: file
    path: ~/.config/openai-responses-mcp/policy.md
    merge: append   # replace | prepend | append
```
Sample: `config/policy.md.example`

### 6) Logs and debugging
- Debug ON (console): `--debug` / `DEBUG=1|true` / YAML `server.debug: true` (priority: CLI > ENV > YAML; single decision at startup)
- Debug ON (file + console mirror): `--debug ./_debug.log` or `DEBUG=./_debug.log`
- Debug OFF: only minimal operational logs

Notes (controlled via YAML):
- `server.debug: true|false` (applies to all modules even if set only in YAML)
- `server.debug_file: <path|null>` (TEE mirror to file when specified)

---

## For Developers (clone and develop)

### 1) Fetch and build
```bash
git clone https://github.com/<your-org>/openai-responses-mcp.git
cd openai-responses-mcp
npm i
npm run build
```

### 2) Smoke test (MCP framing)
```bash
npm run mcp:smoke | tee /tmp/mcp-smoke.out
grep -c '^Content-Length:' /tmp/mcp-smoke.out   # OK if 3 or more
```

### 3) Run locally (stdio)
```bash
export OPENAI_API_KEY="sk-..."
node build/index.js --stdio --debug ./_debug.log
```

### 4) Demo (sample query to OpenAI)
```bash
npm run mcp:quick -- "今日の東京の気温"   # answer_quick
npm run mcp:answer -- "今日の東京の気温"  # answer
npm run mcp:smoke:ldjson   # NDJSON-compatible connectivity check
```

### 5) Documentation (references)
- Canonical spec: `docs/spec.md`
- Reference: `docs/reference/config-reference.md` / `docs/reference/client-setup-claude.md`
- Verification steps: `docs/verification.md`

---

## For Maintainers (distribution)

### Check and publish the npm package
```bash
npm pack --dry-run    # Verify included files (only build/ and README/LICENSE/samples)
npm publish           # Publish (unscoped)
```

---

## Troubleshooting (Essentials)
- `Missing API key`: `OPENAI_API_KEY` not set. Review your environment variables
- `Cannot find module build/index.js`: Not built → run `npm run build`
- Framing mismatch: Check with `npm run mcp:smoke` and rebuild
- Frequent 429/5xx: Adjust `request.max_retries`/`timeout_ms` (YAML)

---

## License
MIT

## Notes

<p><a href="https://medium.com/@uchimanajet7/experimenting-with-openai-codex-and-claude-code-openai-responses-mcp-dev-notes-b121b0d19903">Experimenting with OpenAI Codex and Claude Code: openai-responses-mcp Dev Notes
</a></p>
