import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readCsv, mean, quantile } from '../lib.mjs';

const latest = JSON.parse(readFileSync(new URL('../results/latest.json', import.meta.url), 'utf8'));
const directory = new URL('../results/' + latest.run_id + '/', import.meta.url);
const generations = readCsv(new URL('generations.csv', directory));
const evaluations = readCsv(new URL('evaluations.csv', directory));
const summary = JSON.parse(readFileSync(new URL('summary.json', directory), 'utf8'));

test('ledger contains all 80 real generations and a matching explicit review for each', () => {
  assert.equal(generations.length, 80);
  assert.equal(new Set(generations.map(row => row.trial_id)).size, 80);
  assert.equal(evaluations.length, 80);
  const lookup = new Map(generations.map(row => [row.trial_id, row]));
  for (const review of evaluations) {
    const source = lookup.get(review.trial_id);
    assert.equal(source.status, 'ok');
    assert.equal(review.evaluated_output_sha256, createHash('sha256').update(source.final_output).digest('hex'));
    assert.ok(review.feedback.length > 20);
    assert.match(review.reviewer, /agent/);
    assert.equal(Number(review.weighted_score_1_to_5), (2 * Number(review.fidelity) + Number(review.grammar) + Number(review.tone_clarity)) / 4);
    assert.ok(Number(source.first_token_ms) <= Number(source.total_ms));
  }
});

test('published aggregates retain latency outliers and agree with every trial', () => {
  for (const model of summary.models) {
    const rows = generations.filter(row => row.model === model.model);
    const reviews = evaluations.filter(row => row.model === model.model);
    assert.equal(new Set(rows.map(row => row.case_id)).size, 20);
    assert.equal(rows.length, 40);
    assert.equal(model.mean_seconds, mean(rows.map(row => Number(row.total_ms) / 1000)));
    assert.equal(model.p95_seconds, quantile(rows.map(row => Number(row.total_ms) / 1000), .95));
    assert.equal(model.useful_count, reviews.filter(row => row.useful_by_protocol === 'true').length);
    assert.equal(model.critical_errors, reviews.filter(row => row.critical_semantic_error === 'true').length);
  }
  assert.equal(summary.outliers.length, 1);
  assert.ok(summary.outliers[0].total_seconds > 117);
  assert.equal(summary.costs.quote.infrastructure_usd, 197.4);
  assert.equal(summary.costs.quote.price_per_client_usd, 5);
  assert.equal(summary.costs.full_business_break_even.minimum_clients, null);
  assert.equal(summary.costs.capacity.requests_per_client, null);
  assert.equal('economics' in summary, false);
  const published = JSON.parse(readFileSync(new URL('../../public/benchmark-results/summary.json', import.meta.url), 'utf8'));
  assert.deepEqual(published, summary);
});
