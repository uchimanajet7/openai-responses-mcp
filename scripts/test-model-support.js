#!/usr/bin/env node
// 既定モデル、利用者設定、実際のリクエスト組み立てを、API通信なしで回帰検証する。

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaults, REASONING_EFFORTS } from "../build/config/defaults.js";
import { loadConfig } from "../build/config/load.js";
import { callResponsesWithRetry } from "../build/openai/client.js";
import { callAnswer } from "../build/tools/answer.js";

assert.deepEqual(REASONING_EFFORTS, ["none", "low", "medium", "high", "xhigh", "max"]);
assert.equal(defaults.model_profiles.answer.model, "gpt-6-astra");
assert.equal(defaults.model_profiles.answer.reasoning_effort, "medium");
assert.equal(defaults.model_profiles.answer.verbosity, "medium");

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

const fixtureRoot = fileURLToPath(new URL("../_local/_ai-agent/tmp/", import.meta.url));
mkdirSync(fixtureRoot, { recursive: true });
const fixtureDir = mkdtempSync(join(fixtureRoot, "model-support-"));
const originalFetch = globalThis.fetch;
const testKeyEnv = "OPENAI_RESPONSES_MCP_TEST_API_KEY";
const originalTestKey = process.env[testKeyEnv];
try {
  const requests = [];
  process.env[testKeyEnv] = "test-key-not-a-real-api-key";
  // SDKのHTTP境界だけを置き換え、設定読込とcallAnswerは製品の実装を通す。
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    assert.equal(request.method, "POST");
    assert.equal(new URL(request.url).pathname, "/v1/responses");
    const body = await request.json();
    requests.push(body);
    return Response.json({
      id: "resp_test",
      object: "response",
      status: "completed",
      model: body.model,
      output: [{
        type: "message", role: "assistant", status: "completed",
        content: [{ type: "output_text", text: "HTTP 404 は Not Found です。", annotations: [] }]
      }]
    });
  };

  async function requestFor(cfg, profileName) {
    requests.length = 0;
    const result = await callAnswer({ query: "HTTP 404 の意味は？" }, {
      ...cfg,
      openai: { ...cfg.openai, api_key_env: testKeyEnv, base_url: "https://model-test.invalid/v1" },
      request: { ...cfg.request, max_retries: 0 }
    }, profileName);
    assert.equal(requests.length, 1);
    assert.equal(result.answer, "HTTP 404 は Not Found です。");
    assert.equal(result.model, requests[0].model);
    assert.equal(result.used_search, false);
    assert.deepEqual(result.citations, []);
    assert.deepEqual(requests[0].tools, [{ type: "web_search" }]);
    assert.deepEqual(requests[0].include, ["web_search_call.action.sources"]);
    return requests[0];
  }

  const defaultConfig = loadConfig({ cli: {}, env: {} }).effective;
  for (const tool of ["answer", "answer_detailed", "answer_quick"]) {
    const request = await requestFor(defaultConfig, tool);
    assert.equal(request.model, "gpt-6-astra");
    assert.deepEqual(request.reasoning, { effort: "medium" });
    assert.deepEqual(request.text, { verbosity: "medium" });
  }

  const examplePath = fileURLToPath(new URL("../config/config.yaml.example", import.meta.url));
  const example = loadConfig({ cli: { configPath: examplePath }, env: {} }).effective;
  for (const [tool, effort, verbosity] of [
    ["answer", "medium", "medium"],
    ["answer_detailed", "high", "high"],
    ["answer_quick", "low", "low"]
  ]) {
    const request = await requestFor(example, tool);
    assert.equal(request.model, "gpt-6-astra");
    assert.deepEqual(request.reasoning, { effort });
    assert.deepEqual(request.text, { verbosity });
  }

  // Astraの対応値は公式モデル仕様から列挙し、共通の設定許可値とは分ける。
  for (const effort of ["low", "medium", "high", "xhigh", "max"]) {
    const cfg = loadConfig({ cli: {}, env: { ANSWER_EFFORT: effort } }).effective;
    assert.deepEqual((await requestFor(cfg)).reasoning, { effort });
  }

  const userPath = join(fixtureDir, "user.yaml");
  writeFileSync(userPath, "model_profiles:\n  answer:\n    model: gpt-4.1\n");
  const userConfig = loadConfig({ cli: { configPath: userPath }, env: {} }).effective;
  const userRequest = await requestFor(userConfig);
  assert.equal(userRequest.model, "gpt-4.1");
  assert.equal(Object.hasOwn(userRequest, "reasoning"), false);
  assert.equal(Object.hasOwn(userRequest, "text"), false);

  // YAMLよりENVが優先され、モデルごとに必要な項目だけが送られることを確認する。
  for (const [model, reasoning, text] of [
    ["gpt-6-astra", { effort: "medium" }, { verbosity: "medium" }],
    ["gpt-5.6-sol", { effort: "medium" }, { verbosity: "medium" }],
    ["gpt-5.6-terra", { effort: "medium" }, { verbosity: "medium" }],
    ["gpt-5.6-luna", { effort: "medium" }, { verbosity: "medium" }],
    ["o3", { effort: "medium" }, undefined],
    ["o4-mini", { effort: "medium" }, undefined]
  ]) {
    const cfg = loadConfig({ cli: { configPath: userPath }, env: { MODEL_ANSWER: model } }).effective;
    const request = await requestFor(cfg);
    assert.equal(request.model, model);
    assert.deepEqual(request.reasoning, reasoning);
    assert.deepEqual(request.text, text);
  }

  const nonReasoning = loadConfig({ cli: { configPath: examplePath }, env: { MODEL_ANSWER: "gpt-4.1" } }).effective;
  const nonReasoningRequest = await requestFor(nonReasoning);
  assert.equal(nonReasoningRequest.model, "gpt-4.1");
  assert.equal(Object.hasOwn(nonReasoningRequest, "reasoning"), false);
  assert.equal(Object.hasOwn(nonReasoningRequest, "text"), false);
  const detailedRequest = await requestFor(nonReasoning, "answer_detailed");
  assert.equal(detailedRequest.model, "gpt-6-astra");
  assert.deepEqual(detailedRequest.reasoning, { effort: "high" });

  const noReasoning = loadConfig({ cli: {}, env: { MODEL_ANSWER: "gpt-5.6-sol", ANSWER_EFFORT: "none" } }).effective;
  assert.deepEqual((await requestFor(noReasoning)).reasoning, { effort: "none" });

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
  globalThis.fetch = originalFetch;
  if (originalTestKey === undefined) delete process.env[testKeyEnv];
  else process.env[testKeyEnv] = originalTestKey;
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

console.log("[test] model-support: OK");
