import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { importBenchmarkFeedback, BENCHMARK_FEEDBACK_PREFIX } from '../feedback.mjs';
import { FEEDBACK_COLUMNS } from '../../src/feedback-csv.ts';
import { readCsv } from '../lib.mjs';

test('benchmark import uses the app CSV format, preserves existing bytes and does not duplicate trials', () => {
  const temp = mkdtempSync(join(tmpdir(), 'mail-polish-feedback-'));
  try {
    const target = join(temp, 'feedback.csv');
    const original = '\ufeff' + FEEDBACK_COLUMNS.join(',') + '\r\n"2026-01-01","qwen","academic","warm","5","Original","Result","Comentario humano"\r\n';
    writeFileSync(target, original);
    const latest = JSON.parse(readFileSync(new URL('../results/latest.json', import.meta.url), 'utf8'));
    const directory = fileURLToPath(new URL('../results/' + latest.run_id, import.meta.url));
    assert.equal(importBenchmarkFeedback(directory, target).added, 80);
    const once = readFileSync(target);
    assert.ok(once.subarray(0, Buffer.byteLength(original)).equals(Buffer.from(original)));
    const rows = readCsv(target);
    assert.equal(rows.length, 81);
    assert.deepEqual(Object.keys(rows[1]), [...FEEDBACK_COLUMNS]);
    assert.ok(rows.slice(1).every(row => row.feedback.startsWith(BENCHMARK_FEEDBACK_PREFIX)));
    assert.ok(rows.slice(1).every(row => /^[1-5]$/.test(row.rating)));
    assert.ok(rows.slice(1).every(row => !row.result.includes('\n') && row.result.includes('\\n')));
    assert.equal(once.toString('utf8').trimEnd().split(/\r?\n/).length, 82);
    assert.equal(importBenchmarkFeedback(directory, target).added, 0);
    assert.ok(readFileSync(target).equals(once));
  } finally { rmSync(temp, { recursive: true }); }
});
