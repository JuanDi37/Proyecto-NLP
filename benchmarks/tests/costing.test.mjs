import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { infrastructureCost, fullBreakEven, theoreticalQuota } from '../costing.mjs';
const inputs = JSON.parse(readFileSync(new URL('../cost-inputs.json', import.meta.url), 'utf8'));

test('public hourly and storage rates give a traceable infrastructure-only threshold', () => {
  const q = infrastructureCost(inputs);
  assert.equal(q.billed_gpu_hours, 720);
  assert.equal(q.gpu_compute_usd, 194.4);
  assert.equal(q.container_disk_usd, 1);
  assert.equal(q.volume_disk_usd, 2);
  assert.equal(q.infrastructure_usd, 197.4);
  assert.equal(q.minimum_clients_cover_infrastructure, 40);
  assert.equal(q.minimum_clients_positive_infrastructure_margin, 40);
  assert.equal(infrastructureCost(inputs, { period_days: 31 }).infrastructure_usd, 203.88);
});
test('exact break-even differs from strictly positive profit, without floating point off-by-one', () => {
  const q = infrastructureCost(inputs, { price_per_client_usd: 4.7 });
  assert.equal(q.minimum_clients_cover_infrastructure, 42);
  assert.equal(q.minimum_clients_positive_infrastructure_margin, 43);
});
test('unquoted costs remain missing, while explicit zero and nonpositive contribution are distinct', () => {
  const q = infrastructureCost(inputs);
  assert.equal(fullBreakEven(q, inputs.not_measured_or_quoted).status, 'missing_inputs');
  const explicit = { payment_percentage:0,payment_fixed_usd_per_client_month:0,additional_fixed_usd_per_month:0,additional_variable_usd_per_client_month:0,tax_usd_per_month:0 };
  assert.equal(fullBreakEven(q, explicit).minimum_clients, 40);
  assert.equal(fullBreakEven(q, { ...explicit, payment_fixed_usd_per_client_month: .30 }).minimum_clients, 42);
  assert.equal(fullBreakEven(q, { ...explicit, payment_fixed_usd_per_client_month: 5 }).status, 'non_positive_contribution');
});
test('laptop latency cannot establish a rented GPU email quota', () => {
  assert.equal(theoreticalQuota({ billedSeconds:2592000, clients:40, measuredCloudSecondsPerRequest:null }).requests_per_client, null);
  assert.deepEqual(theoreticalQuota({ billedSeconds:2592000, clients:40, measuredCloudSecondsPerRequest:3 }), { status:'ideal_upper_bound_not_slo',requests_per_client:21600 });
});
