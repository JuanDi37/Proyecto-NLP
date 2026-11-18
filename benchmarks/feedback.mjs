import { readFileSync, writeFileSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { FEEDBACK_COLUMNS, feedbackCsvCell } from '../src/feedback-csv.ts';
import { parseCsv, readCsv } from './lib.mjs';

export const BENCHMARK_FEEDBACK_PREFIX = '[BENCHMARK_AGENT ';

export function importBenchmarkFeedback(directory, target = 'data/feedback.csv') {
  const metadata = JSON.parse(readFileSync(join(directory, 'metadata.json'), 'utf8'));
  const evaluations = readCsv(join(directory, 'evaluations.csv'));
  const source = new Map(readFileSync(join(directory, 'generations.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => {
    const row = JSON.parse(line); return [row.trial_id, row];
  }));
  const existingText = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (existingText && JSON.stringify(parseCsv(existingText)[0]) !== JSON.stringify(FEEDBACK_COLUMNS)) {
    throw new Error('feedback.csv has an unexpected header; no data was changed');
  }
  const existing = new Set(readCsv(target).map(row => row.feedback.split(']')[0] + ']'));
  const rows = evaluations.map(review => {
    const original = source.get(review.trial_id);
    if (!original || original.status !== 'ok' || original.model !== review.model ||
        createHash('sha256').update(original.final_output).digest('hex') !== review.evaluated_output_sha256) {
      throw new Error(`Feedback source does not match reviewed output: ${review.trial_id}`);
    }
    const exact = Number(review.weighted_score_1_to_5);
    if (!Number.isFinite(exact) || exact < 1 || exact > 5) throw new Error('Invalid benchmark rating');
    const marker = `${BENCHMARK_FEEDBACK_PREFIX}run=${metadata.run_id} trial=${review.trial_id}]`;
    return {
      timestamp: original.timestamp,
      model: original.model,
      setting: original.setting,
      tone: original.tone,
      rating: Math.round(exact),
      draft: original.draft,
      result: original.final_output,
      feedback: `${marker} Evaluación del agente, no opinión humana. Nota ponderada original=${exact}/5; rating redondeado al entero más cercano. Fidelidad=${review.fidelity}/5; gramática=${review.grammar}/5; tono=${review.tone_clarity}/5; error crítico=${review.critical_semantic_error}; aprobado=${review.useful_by_protocol}. Tiempo total=${(Number(original.total_ms) / 1000).toFixed(3)} s; primer token=${(Number(original.first_token_ms) / 1000).toFixed(3)} s. ${review.feedback}`,
      marker,
    };
  });
  // Validate the full import before appending anything, preserving every existing byte.
  mkdirSync(dirname(target), { recursive: true });
  if (!existingText) writeFileSync(target, '\ufeff' + FEEDBACK_COLUMNS.join(',') + '\r\n');
  let added = 0;
  for (const row of rows) {
    if (existing.has(row.marker)) continue;
    if (!added && existingText && !/[\r\n]$/.test(existingText)) appendFileSync(target, '\r\n');
    appendFileSync(target, FEEDBACK_COLUMNS.map(key => feedbackCsvCell(row[key])).join(',') + '\r\n');
    existing.add(row.marker); added++;
  }
  return { added, already_present: rows.length - added, total_records: readCsv(target).length, target };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const latest = JSON.parse(readFileSync('benchmarks/results/latest.json', 'utf8'));
  console.log(JSON.stringify(importBenchmarkFeedback(resolve('benchmarks/results', latest.run_id)), null, 2));
}
