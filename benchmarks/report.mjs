import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { readCsv, appendCsv, csvCell, mean, quantile, missingFacts } from './lib.mjs';
import { importBenchmarkFeedback, BENCHMARK_FEEDBACK_PREFIX } from './feedback.mjs';
import { buildCostReport } from './costing.mjs';
import { executionScenario } from './strategies.mjs';

const latest = JSON.parse(readFileSync('benchmarks/results/latest.json', 'utf8'));
const directory = resolve('benchmarks/results', latest.run_id);
const metadata = JSON.parse(readFileSync(join(directory, 'metadata.json'), 'utf8'));
const cases = JSON.parse(readFileSync('benchmarks/cases.json', 'utf8'));
const samples = new Map(cases.map(item => [item.id, item]));
const generations = [...new Map(readCsv(join(directory, 'generations.csv')).map(row => [row.trial_id, row])).values()];
const decisions = JSON.parse(readFileSync(join(directory, 'review-decisions.json'), 'utf8'));
const reviews = new Map();
for (const [group, entries] of Object.entries(decisions.groups)) {
  const [alias, repetition] = group.split(':');
  const model = alias === 'Q' ? 'qwen3.5:4b-q4_K_M' : 'gemma3:4b';
  for (const [id, fidelity, grammar, tone, critical, comment] of entries) {
    if ([fidelity, grammar, tone].some(x => !Number.isInteger(x) || x < 1 || x > 5)) throw new Error('Invalid review score');
    const key = `${model}|${id}|${repetition}`;
    if (reviews.has(key)) throw new Error(`Duplicate review: ${key}`);
    reviews.set(key, { fidelity, grammar, tone, critical, comment });
  }
}

function saveCsv(path, rows) {
  if (!rows.length) throw new Error(`No rows for ${path}`);
  const columns = Object.keys(rows[0]);
  writeFileSync(path, '\ufeff' + [columns, ...rows.map(row => columns.map(key => row[key]))].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n');
}
const evaluations = generations.map(row => {
  const sample = samples.get(row.case_id), review = reviews.get(row.trial_id);
  if (row.status !== 'ok') return { ...row, useful: false };
  if (!review) throw new Error(`Missing agent review: ${row.trial_id}`);
  const score = (2 * review.fidelity + review.grammar + review.tone) / 4;
  const placeholders = (row.final_output.match(/\[[^\]\n]+\]/g) ?? []).length;
  const languageCorrect = row.detected_language === sample.language;
  const hasSubject = /^Subject:\s*\S+/i.test(row.final_output);
  const literal = JSON.parse(row.missing_final).length === 0;
  const useful = score >= 4 && !review.critical && literal && placeholders === 0 && languageCorrect && hasSubject && row.done_reason !== 'length';
  const requiredNames = [sample.recipientName, sample.senderName].filter(Boolean);
  return { run_id: latest.run_id, trial_id: row.trial_id, model: row.model, case_id: row.case_id, repetition: Number(row.repetition), language: row.language, reviewer: 'Codex agent; unblinded editorial review, not human feedback', reviewed_at: decisions.reviewed_at, evaluated_output_sha256: createHash('sha256').update(row.final_output).digest('hex'), fidelity: review.fidelity, grammar: review.grammar, tone_clarity: review.tone, weighted_score_1_to_5: score, critical_semantic_error: review.critical, required_facts_preserved: literal, facts_preserved_body_only: missingFacts(sample.facts, row.final_output.split('\n\n').slice(1).join('\n\n')).length === 0, profile_names_raw_exact: missingFacts(requiredNames, row.raw_output).length === 0, profile_names_final_exact: missingFacts(requiredNames, row.final_output).length === 0, language_correct: languageCorrect, placeholders_remaining: placeholders, subject_present: hasSubject, output_modified_by_app: row.raw_output !== row.final_output, useful_by_protocol: useful, total_ms: Number(row.total_ms), first_token_ms: Number(row.first_token_ms), feedback: review.comment };
});
const expected = metadata.cases * metadata.repetitions * metadata.models.length;
if (evaluations.length !== expected || evaluations.some(row => row.status === 'error')) throw new Error(`Incomplete run: ${evaluations.length}/${expected}`);
saveCsv(join(directory, 'evaluations.csv'), evaluations);
const feedbackImport = importBenchmarkFeedback(directory);
const rowsByModel = metadata.models.map(model => {
  const rows = evaluations.filter(row => row.model === model.name);
  const raw = generations.filter(row => row.model === model.name);
  const latencies = rows.map(row => row.total_ms / 1000);
  return { model: model.name, trials: rows.length, distinct_cases: new Set(rows.map(row => row.case_id)).size, repetitions: metadata.repetitions, size_gb: model.size / 1e9, quantization: model.details.quantization_level, mean_seconds: mean(latencies), p50_seconds: quantile(latencies, .5), p95_seconds: quantile(latencies, .95), max_seconds: Math.max(...latencies), first_token_p50_seconds: quantile(rows.map(row => row.first_token_ms / 1000), .5), first_token_p95_seconds: quantile(rows.map(row => row.first_token_ms / 1000), .95), mean_tokens_per_second: mean(raw.map(row => Number(row.tokens_per_second))), fidelity_1_to_5: mean(rows.map(row => row.fidelity)), grammar_1_to_5: mean(rows.map(row => row.grammar)), tone_clarity_1_to_5: mean(rows.map(row => row.tone_clarity)), weighted_score_1_to_5: mean(rows.map(row => row.weighted_score_1_to_5)), useful_count: rows.filter(row => row.useful_by_protocol).length, useful_rate: mean(rows.map(row => Number(row.useful_by_protocol))), critical_errors: rows.filter(row => row.critical_semantic_error).length, critical_error_rate: mean(rows.map(row => Number(row.critical_semantic_error))), literal_fact_pass_count: rows.filter(row => row.required_facts_preserved).length, literal_fact_pass_rate: mean(rows.map(row => Number(row.required_facts_preserved))), placeholders_count: rows.filter(row => row.placeholders_remaining).length, modified_by_app_count: rows.filter(row => row.output_modified_by_app).length };
});
saveCsv(join(directory, 'summary.csv'), rowsByModel);
const byLanguage = rowsByModel.flatMap(model => ['Spanish', 'English'].map(language => {
  const rows = evaluations.filter(row => row.model === model.model && row.language === language);
  return { model: model.model, language, trials: rows.length, mean_seconds: mean(rows.map(row => row.total_ms / 1000)), useful_count: rows.filter(row => row.useful_by_protocol).length, score: mean(rows.map(row => row.weighted_score_1_to_5)), critical_errors: rows.filter(row => row.critical_semantic_error).length };
}));
saveCsv(join(directory, 'by-language.csv'), byLanguage);

// Public infrastructure quote and user-specified price; no inferred customer savings.
const costs = buildCostReport(JSON.parse(readFileSync('benchmarks/cost-inputs.json', 'utf8')));
costs.execution_strategies = JSON.parse(readFileSync('benchmarks/strategies.json', 'utf8'));
saveCsv(join(directory, 'execution-strategies.csv'), ['always','schedule','flex'].flatMap(mode => [0,10,20,30,40,50,75,100].map(clients => executionScenario(costs.execution_strategies, mode, clients))));
const costItems = [
  { component: 'GPU rental', quantity: costs.quote.billed_gpu_hours, unit: 'GPU-hour', unit_price_usd: costs.inputs.hourly_gpu_usd, amount_usd: costs.quote.gpu_compute_usd },
  { component: 'Container disk', quantity: costs.quote.container_disk_gb, unit: 'GB-month', unit_price_usd: costs.inputs.storage_usd_per_gb_month, amount_usd: costs.quote.container_disk_usd },
  { component: 'Persistent volume', quantity: costs.quote.volume_disk_gb, unit: 'GB-month', unit_price_usd: costs.inputs.storage_usd_per_gb_month, amount_usd: costs.quote.volume_disk_usd }
];
saveCsv(join(directory, 'economics.csv'), costItems);
saveCsv(join(directory, 'infrastructure-costs.csv'), costItems);
saveCsv(join(directory, 'cashflow.csv'), costs.cashflow);
saveCsv(join(directory, 'sensitivity.csv'), costs.sensitivity);
const policies = rowsByModel.flatMap(model => [4,4.25,4.5,4.75,5].map(threshold => ({ model: model.model, review_threshold: threshold, approved_cases: evaluations.filter(row => row.model === model.model && row.weighted_score_1_to_5 >= threshold && !row.critical_semantic_error && row.required_facts_preserved && row.placeholders_remaining === 0 && row.language_correct && row.subject_present).length, trials: model.trials, interpretation: 'Offline editorial gate; no monetary valuation or production demand inferred' })));
saveCsv(join(directory, 'review-policies.csv'), policies);
writeFileSync(join(directory, 'costs.json'), JSON.stringify(costs, null, 2));

const historical = readCsv('data/feedback.csv').filter(row => !row.feedback.startsWith(BENCHMARK_FEEDBACK_PREFIX));
const ratings = historical.map(row => Number(row.rating)).filter(value => value >= 1 && value <= 5);
const historySummary = { records: historical.length, numeric_ratings: ratings.length, mean_rating: mean(ratings), source: 'human feedback stored before this benchmark; not a blinded comparison', agent_note: 'El ejemplo histórico valorado 5/5 añade una referencia a adjuntar un correo y convierte una condición en una afirmación. La valoración positiva no demuestra fidelidad factual. El registro no conserva los campos de nombres del perfil, por lo que su procedencia no puede determinarse.' };
const historicDecisionPath = 'data/feedback_evaluation.csv';
const alreadyReviewed = new Set(readCsv(historicDecisionPath).map(row => row.source_timestamp));
for (const row of historical) if (!alreadyReviewed.has(row.timestamp)) {
  appendCsv(historicDecisionPath, { source_timestamp: row.timestamp, model: row.model, original_human_rating: row.rating, original_human_comment: row.feedback, reviewer: 'Codex agent; not a new user rating', review_timestamp: new Date().toISOString(), assessment: row.timestamp === '2026-11-12T19:48:32.359Z' ? historySummary.agent_note : 'Registro no revisado individualmente en esta ejecución; no inferir calidad a partir de la valoración.' });
}
const examples = ['ES03', 'EN06'].map(id => ({ case_id: id, draft: samples.get(id).draft, outputs: evaluations.filter(row => row.case_id === id && row.repetition === 1).map(row => ({ model: row.model, text: generations.find(g => g.trial_id === row.trial_id).final_output, feedback: row.feedback, critical: row.critical_semantic_error })) }));
const outliers = generations.filter(row => Number(row.total_ms) > 15000).map(row => ({ model: row.model, case_id: row.case_id, repetition: Number(row.repetition), total_seconds: Number(row.total_ms) / 1000, first_token_seconds: Number(row.first_token_ms) / 1000, server_seconds: Number(row.ollama_total_ms) / 1000, tokens_per_second: Number(row.tokens_per_second) }));
const summary = { run_id: latest.run_id, metadata, models: rowsByModel, by_language: byLanguage, historical_feedback: historySummary, costs, policies, examples, outliers, feedback_type: 'Agent editorial ratings + deterministic checks; human historical rating analyzed separately.', limits: ['20 authored cases with 2 repetitions, not 80 independent emails.', 'Editorial reviewer is an agent and knows model identities; no inter-rater agreement.', 'Quality is scored after existing app postprocessing; raw output is also retained.', 'Latency is direct local API with a warmed model, not a production SLO or user editing time.', 'Outliers are retained; cause not established.', 'Costs use public Runpod rates for an explicit 30-day single-GPU configuration; not an actual invoice.', 'User selected USD 5/month. Unquoted taxes, fees and business costs remain missing; 40 clients only covers quoted infrastructure.', 'Cloud GPU throughput and a sustainable email quota are unmeasured. Laptop performance cannot establish cloud capacity.'] };
writeFileSync(join(directory, 'summary.json'), JSON.stringify(summary, null, 2));
const published = resolve('public/benchmark-results'); mkdirSync(published, { recursive: true });
for (const filename of ['generations.csv','evaluations.csv','summary.csv','by-language.csv','economics.csv','infrastructure-costs.csv','cashflow.csv','costs.json','execution-strategies.csv','sensitivity.csv','review-policies.csv','metadata.json','summary.json','warmups.csv']) copyFileSync(join(directory, filename), join(published, filename));
if (!process.argv.includes('--data-only')) {
  const template = readFileSync('benchmarks/presentation.template.html', 'utf8');
  const spacedHeadings = template.replace(/(<h2\b[^>]*>)([\s\S]*?)(<\/h2>)/g, (_, open, body, close) => open + body.replaceAll('<br>', ' <br>') + close);
  const withCalculator = spacedHeadings.replace('__COST_FUNCTIONS__', readFileSync('benchmarks/costing.mjs', 'utf8').replace(/^export /gm, '')).replace('__STRATEGY_FUNCTIONS__', readFileSync('benchmarks/strategies.mjs','utf8').replace(/^export /gm,''));
  writeFileSync('presentacion.html', withCalculator.replace('__BENCHMARK_DATA__', JSON.stringify(summary).replaceAll('<', '\\u003c')));
}
console.log(JSON.stringify({ run_id: latest.run_id, feedback_import: feedbackImport, summary: rowsByModel, costs: costs.quote, outliers }, null, 2));
