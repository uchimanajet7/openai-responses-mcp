#!/usr/bin/env node
// ビルド生成物のみを削除する。依存関係の再作成は npm ci が担当する。
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targets = ['build'];

try {
  for (const target of targets) {
    const absolutePath = resolve(projectRoot, target);
    if (existsSync(absolutePath)) {
      rmSync(absolutePath, { recursive: true, force: true });
      console.log(`[clean:build] removed: ${absolutePath}`);
    } else {
      console.log(`[clean:build] not found: ${absolutePath}`);
    }
  }
  process.exit(0);
} catch (e) {
  console.error(`[clean:build] failed: ${e?.message ?? e}`);
  process.exit(1);
}
