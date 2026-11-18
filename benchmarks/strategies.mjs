export function executionScenario(config, mode, clients, requestsPerClient = config.default_requests_per_client_month, billedSeconds = config.default_billed_seconds_per_request, startupSeconds = config.cold_start_seconds_per_request) {
  if (!['always','schedule','flex'].includes(mode)) throw new Error('Unknown execution mode');
  if (![clients, requestsPerClient, billedSeconds].every(x => Number.isFinite(x) && x >= 0)) throw new Error('Invalid workload');
  if (startupSeconds != null && (!Number.isFinite(startupSeconds) || startupSeconds < 0)) throw new Error('Invalid startup time');
  const perRequestSeconds = billedSeconds + (mode === 'flex' ? startupSeconds ?? 0 : 0);
  const hours = config.period_days * 24;
  let compute, storage, billedHours, workers = 1;
  if (mode === 'flex') {
    billedHours = clients * requestsPerClient * Math.ceil(perRequestSeconds) / 3600;
    workers = Math.max(1, Math.ceil(billedHours / hours));
    compute = billedHours * config.flex_hourly_equivalent_usd;
    storage = config.flex_network_volume_gb * config.flex_network_gb_month_usd + workers * config.flex_container_gb_per_worker * config.flex_container_gb_month_usd;
  } else {
    billedHours = mode === 'always' ? hours : config.scheduled_days * config.scheduled_hours_per_day;
    if (billedHours > hours) throw new Error('Schedule exceeds billing period');
    compute = billedHours * config.pod_hourly_usd;
    storage = config.pod_container_gb * config.pod_running_storage_gb_month_usd * billedHours / hours + config.pod_volume_gb * (config.pod_running_storage_gb_month_usd * billedHours / hours + config.pod_stopped_volume_gb_month_usd * (hours - billedHours) / hours);
  }
  const cost = Math.round((compute + storage) * 100) / 100;
  return { mode, clients, requests_per_client_month: requestsPerClient, cold_start_seconds_per_activation: mode === 'flex' ? startupSeconds ?? null : null, cold_starts_per_request_scenario: mode === 'flex' ? 1 : 0, cost_is_lower_bound: mode === 'flex' && startupSeconds == null, billed_seconds_per_request_scenario: Math.ceil(perRequestSeconds), billed_gpu_hours: billedHours, minimum_workers_ideal: workers, compute_usd: Math.round(compute * 100) / 100, storage_budget_usd: Math.round(storage * 100) / 100, infrastructure_usd: cost, revenue_usd: clients * config.price_per_client_usd, margin_before_other_costs_usd: Math.round((clients * config.price_per_client_usd - cost) * 100) / 100 };
}

export function scenarioBreakEven(config, mode, requestsPerClient, billedSeconds = config.default_billed_seconds_per_request, startupSeconds = config.cold_start_seconds_per_request) {
  if (mode === 'flex' && startupSeconds == null) return null;
  if (mode === 'flex' && requestsPerClient * Math.ceil(billedSeconds + startupSeconds) / 3600 * config.flex_hourly_equivalent_usd >= config.price_per_client_usd) return null;
  for (let clients = 1; clients <= 100000; clients++) {
    const result = executionScenario(config, mode, clients, requestsPerClient, billedSeconds, startupSeconds);
    if (result.margin_before_other_costs_usd >= 0) return clients;
  }
  return null;
}
