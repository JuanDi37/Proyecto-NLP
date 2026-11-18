// Cash infrastructure costs and break-even arithmetic; no valuation of user time.
export function infrastructureCost(inputs, overrides = {}) {
  const config = { ...inputs.configuration, ...overrides };
  for (const key of ['gpu_count','period_days','hours_per_day','container_disk_gb','volume_disk_gb','price_per_client_usd']) {
    if (!Number.isFinite(config[key]) || config[key] < 0) throw new Error(`Invalid ${key}`);
  }
  if (config.gpu_count < 1 || !Number.isInteger(config.gpu_count) || config.period_days <= 0 || config.hours_per_day > 24) throw new Error('Invalid server configuration');
  const billedHours = config.period_days * config.hours_per_day;
  const computeCents = Math.round(inputs.hourly_gpu_usd * billedHours * config.gpu_count * 100);
  const containerCents = Math.round(config.container_disk_gb * inputs.storage_usd_per_gb_month * 100);
  const volumeCents = Math.round(config.volume_disk_gb * inputs.storage_usd_per_gb_month * 100);
  if (config.hours_per_day !== 24) throw new Error('This quote covers continuously running Pods; stopped-volume pricing must be modeled separately');
  const cents = computeCents + containerCents + volumeCents;
  const priceCents = Math.round(config.price_per_client_usd * 100);
  return {
    currency: inputs.currency, ...config,
    billed_gpu_hours: billedHours * config.gpu_count,
    gpu_compute_usd: computeCents / 100,
    container_disk_usd: containerCents / 100,
    volume_disk_usd: volumeCents / 100,
    infrastructure_usd: cents / 100,
    minimum_clients_cover_infrastructure: priceCents > 0 ? Math.ceil(cents / priceCents) : null,
    minimum_clients_positive_infrastructure_margin: priceCents > 0 ? Math.floor(cents / priceCents) + 1 : null,
    scope: 'Infrastructure-only quote; not total business profit; assumes demand fits this one server.'
  };
}

export function fullBreakEven(quote, costs) {
  const required = ['payment_percentage','payment_fixed_usd_per_client_month','additional_fixed_usd_per_month','additional_variable_usd_per_client_month','tax_usd_per_month'];
  if (required.some(key => costs[key] === null || costs[key] === undefined || costs[key] === '')) return { status: 'missing_inputs', minimum_clients: null, minimum_clients_positive_profit: null };
  if (required.some(key => !Number.isFinite(Number(costs[key])) || Number(costs[key]) < 0) || Number(costs.payment_percentage) > 100) throw new Error('Invalid business costs');
  const priceCents = Math.round(quote.price_per_client_usd * 100);
  const percentageCents = Math.round(priceCents * Number(costs.payment_percentage) / 100);
  const contribution = priceCents - percentageCents - Math.round(Number(costs.payment_fixed_usd_per_client_month) * 100) - Math.round(Number(costs.additional_variable_usd_per_client_month) * 100);
  const fixed = Math.round(quote.infrastructure_usd * 100) + Math.round(Number(costs.additional_fixed_usd_per_month) * 100) + Math.round(Number(costs.tax_usd_per_month) * 100);
  if (contribution <= 0) return { status: 'non_positive_contribution', minimum_clients: null, minimum_clients_positive_profit: null, contribution_per_client_usd: contribution / 100 };
  return { status: 'computed', minimum_clients: Math.ceil(fixed / contribution), minimum_clients_positive_profit: Math.floor(fixed / contribution) + 1, contribution_per_client_usd: contribution / 100, fixed_usd: fixed / 100 };
}

export function theoreticalQuota({ billedSeconds, clients, measuredCloudSecondsPerRequest }) {
  if (measuredCloudSecondsPerRequest === null || measuredCloudSecondsPerRequest === undefined) return { status: 'cloud_measurement_required', requests_per_client: null };
  if (![billedSeconds,clients,measuredCloudSecondsPerRequest].every(x => Number.isFinite(x) && x > 0)) throw new Error('Invalid capacity inputs');
  return { status: 'ideal_upper_bound_not_slo', requests_per_client: Math.floor(billedSeconds / clients / measuredCloudSecondsPerRequest) };
}

export function buildCostReport(inputs) {
  const quote = infrastructureCost(inputs);
  return {
    inputs, quote,
    full_business_break_even: fullBreakEven(quote, inputs.not_measured_or_quoted),
    capacity: theoreticalQuota({ billedSeconds: quote.billed_gpu_hours * 3600, clients: quote.minimum_clients_cover_infrastructure, measuredCloudSecondsPerRequest: inputs.not_measured_or_quoted.seconds_per_request_on_a5000 }),
    cashflow: [10,20,30,39,40,41,50,75,100].map(clients => ({ clients, revenue_usd: clients * quote.price_per_client_usd, infrastructure_usd: quote.infrastructure_usd, infrastructure_margin_usd: Math.round((clients * quote.price_per_client_usd - quote.infrastructure_usd) * 100) / 100, excludes_unquoted_business_costs: true })),
    sensitivity: ['hourly_gpu_usd','price_per_client_usd'].flatMap(factor => [.5,.8,1,1.2,1.5].map(multiplier => {
      const adjusted = factor === 'hourly_gpu_usd' ? { ...inputs, hourly_gpu_usd: inputs.hourly_gpu_usd * multiplier } : inputs;
      const config = factor === 'price_per_client_usd' ? { price_per_client_usd: inputs.configuration.price_per_client_usd * multiplier } : {};
      const row = infrastructureCost(adjusted, config);
      return { factor, relative_change_pct: Math.round((multiplier - 1) * 100), input_value: factor === 'hourly_gpu_usd' ? adjusted.hourly_gpu_usd : config.price_per_client_usd, infrastructure_usd: row.infrastructure_usd, minimum_clients_cover_infrastructure: row.minimum_clients_cover_infrastructure, scenario_not_a_new_quote: true };
    })),
    interpretation: 'USD 5/month is user-specified. The quote covers renting one server; compute rent is the same for either model. No per-email cost or email quota is asserted without request volume and a benchmark on the rented GPU. Taxes, collection fees and other operating costs remain unknown, not silently zero.'
  };
}
