#!/usr/bin/env node
// GPT-5.6 の既定値、設定検証、実モデルIDの記録を、APIを呼び出さずに回帰検証する。

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaults, REASONING_EFFORTS } from "../build/config/defaults.js";
import { loadConfig } from "../build/config/load.js";
import { callResponsesWithRetry } from "../build/openai/client.js";

assert.deepEqual(REASONING_EFFORTS, ["none", "low", "medium", "high", "xhigh", "max"]);
assert.equal(defaults.model_profiles.answer.model, "gpt-5.6-sol");
assert.equal(defaults.model_profiles.answer.reasoning_effort, "medium");

for (const effort of REASONING_EFFORTS) {
  const loaded = loadConfig({
    cli: {},
    env: {
      MODEL_ANSWER: "gpt-5.6-terra",
      ANSWER_EFFORT: effort
    }
  });
  assert.equal(loaded.effective.model_profiles.answer.model, "gpt-5.6-terra");
  assert.equal(loaded.effective.model_profiles.answer.reasoning_effort, effort);
  assert.deepEqual(loaded.sources.env, ["MODEL_ANSWER", "ANSWER_EFFORT"]);
}

const fixtureDir = mkdtempSync(join(tmpdir(), "openai-responses-mcp-gpt56-"));
try {
  const validPath = join(fixtureDir, "valid.yaml");
  writeFileSync(validPath, `model_profiles:
  answer:
    model: gpt-5.6-terra
    reasoning_effort: medium
    verbosity: medium
  answer_detailed:
    model: gpt-5.6-sol
    reasoning_effort: max
    verbosity: high
  answer_quick:
    model: gpt-5.6-luna
    reasoning_effort: none
    verbosity: low
`);
  const valid = loadConfig({ cli: { configPath: validPath }, env: {} });
  assert.equal(valid.effective.model_profiles.answer.model, "gpt-5.6-terra");
  assert.equal(valid.effective.model_profiles.answer_detailed?.model, "gpt-5.6-sol");
  assert.equal(valid.effective.model_profiles.answer_detailed?.reasoning_effort, "max");
  assert.equal(valid.effective.model_profiles.answer_quick?.model, "gpt-5.6-luna");
  assert.equal(valid.effective.model_profiles.answer_quick?.reasoning_effort, "none");

  const invalidPath = join(fixtureDir, "invalid.yaml");
  writeFileSync(invalidPath, `model_profiles:
  answer:
    reasoning_effort: minimal
`);
  assert.throws(
    () => loadConfig({ cli: { configPath: invalidPath }, env: {} }),
    /allowed: none\|low\|medium\|high\|xhigh\|max/
  );
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}

const requestArgs = {
  model: "gpt-5.6",
  input: "test",
  reasoning: { effort: "medium" }
};
const capturedRequests = [];
const aliasClient = {
  responses: {
    create: async (args) => {
      capturedRequests.push(args);
      return { model: "gpt-5.6-sol" };
    }
  }
};
const resolved = await callResponsesWithRetry(aliasClient, defaults, requestArgs);
assert.equal(resolved.model, "gpt-5.6-sol");
assert.deepEqual(capturedRequests[0].reasoning, { effort: "medium" });

const fallbackClient = {
  responses: {
    create: async () => ({})
  }
};
const fallback = await callResponsesWithRetry(fallbackClient, defaults, requestArgs);
assert.equal(fallback.model, "gpt-5.6");

console.log("[test] gpt56-support: OK");
