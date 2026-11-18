import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendCsv, readCsv, parseCsv, missingFacts, quantile } from '../lib.mjs';

test('CSV roundtrips commas, quotes, accents and multiline model output', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mail-polish-csv-'));
  try {
    const path = join(dir, 'results.csv');
    const row = { model: 'qwen', output: 'Hola María,\n\nDijo "USD 250".', score: '4.5' };
    appendCsv(path, row); appendCsv(path, { ...row, model: 'gemma' });
    assert.deepEqual(readCsv(path), [row, { ...row, model: 'gemma' }]);
    assert.throws(() => appendCsv(path, { bad: true }), /schema mismatch/);
  } finally { rmSync(dir, { recursive: true }); }
});
test('unterminated CSV fails instead of silently discarding feedback', () => assert.throws(() => parseCsv('a,b\n"unterminated'), /Unterminated/));
test('fact checks ignore case but preserve amounts and identifiers', () => {
  assert.deepEqual(missingFacts(['jueves', 'USD 250', 'PO-5012'], 'Jueves: USD 25, PO-5012'), ['USD 250']);
});
test('percentiles interpolate and empty samples are not zero latency', () => {
  assert.equal(quantile([4, 1, 3, 2], .5), 2.5);
  assert.ok(Math.abs(quantile([4, 1, 3, 2], .95) - 3.85) < 1e-9);
  assert.equal(quantile([], .95), null);
});
