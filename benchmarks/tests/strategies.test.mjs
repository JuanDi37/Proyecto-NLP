import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { executionScenario, scenarioBreakEven } from '../strategies.mjs';
const config = JSON.parse(readFileSync(new URL('../strategies.json', import.meta.url), 'utf8'));
test('24/7 and scheduled costs include storage during off hours', () => {
  assert.equal(executionScenario(config,'always',40).infrastructure_usd,197.4);
  const schedule = executionScenario(config,'schedule',40);
  assert.equal(schedule.billed_gpu_hours,176);
  assert.equal(schedule.compute_usd,47.52);
  assert.equal(schedule.storage_budget_usd,3.76);
  assert.equal(schedule.infrastructure_usd,51.28);
  assert.equal(scenarioBreakEven(config,'schedule',100,30),11);
});
test('demand costs depend on load and include storage, without promising universal savings', () => {
  assert.equal(executionScenario(config,'flex',40,100,30).infrastructure_usd,27.4);
  assert.equal(executionScenario(config,'flex',100,100,30).infrastructure_usd,64.9);
  assert.equal(scenarioBreakEven(config,'flex',100,30,0),1);
  assert.equal(scenarioBreakEven(config,'flex',1000,30),null);
  assert.ok(executionScenario(config,'flex',40,1000,30).infrastructure_usd > 197.4);
  assert.equal(executionScenario(config,'flex',1,1,1.1).billed_seconds_per_request_scenario,2);
});

test('unmeasured cold starts prevent a break-even claim; isolated starts are billed per request', () => {
  assert.equal(executionScenario(config,'flex',40).cost_is_lower_bound,true);
  assert.equal(scenarioBreakEven(config,'flex',100),null);
  const cold=executionScenario(config,'flex',40,100,8.88,60);
  assert.equal(cold.billed_seconds_per_request_scenario,69);
  assert.equal(cold.infrastructure_usd,59.9);
  assert.equal(cold.cost_is_lower_bound,false);
  assert.equal(scenarioBreakEven(config,'flex',1000,8.88,60),null);
  assert.equal(executionScenario(config,'always',40,100,8.88,60).infrastructure_usd,197.4);
  assert.throws(()=>executionScenario(config,'flex',40,100,8.88,-1));
});
