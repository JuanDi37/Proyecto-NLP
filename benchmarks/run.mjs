// Offline-model benchmark. This program only contacts loopback Ollama; no Gmail or send API.
import { mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { MODEL, systemPrompt, detectLanguage } from '../src/ollama.ts';
import { personalizeEmail, detailWarnings } from '../src/email.ts';
import { appendCsv, readCsv, missingFacts } from './lib.mjs';

const endpoint = 'http://127.0.0.1:11434';
const cases = JSON.parse(readFileSync(new URL('./cases.json', import.meta.url), 'utf8'));
const models = [MODEL, 'gemma3:4b'];
const repetitions = Number(process.env.BENCHMARK_REPEATS ?? 2);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 10) throw new Error('Invalid repetitions');
const runId = process.env.BENCHMARK_RUN_ID ?? new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const output = resolve('benchmarks', 'results', runId);
mkdirSync(output, { recursive: true });
const csvPath = join(output, 'generations.csv'), rawPath = join(output, 'generations.jsonl');
const seen = new Set(readCsv(csvPath).filter(row => row.status === 'ok').map(row => row.trial_id));

async function api(path, body) {
  const response = await fetch(endpoint + path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function generate(model, sample, seed) {
  const request = { model, stream: true, think: false, keep_alive: '30m', options: { temperature: 0.3, num_ctx: 4096, num_predict: 512, seed }, messages: [{ role: 'system', content: systemPrompt(sample, sample.draft) }, { role: 'user', content: sample.draft }] };
  const started = performance.now();
  const response = await fetch(endpoint + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request), signal: AbortSignal.timeout(180_000) });
  if (!response.ok || !response.body) throw new Error(`chat: ${response.status} ${await response.text()}`);
  let text = '', buffer = '', firstToken = null, metrics = null;
  const decoder = new TextDecoder();
  function consume(line) {
    if (!line.trim()) return;
    const chunk = JSON.parse(line);
    if (chunk.error) throw new Error(chunk.error);
    if (chunk.message?.content) { firstToken ??= performance.now() - started; text += chunk.message.content; }
    if (chunk.done) metrics = chunk;
  }
  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split('\n'); buffer = lines.pop() ?? ''; lines.forEach(consume);
  }
  buffer += decoder.decode(); if (buffer.trim()) consume(buffer);
  if (!metrics || !text.trim()) throw new Error('Incomplete or empty generation');
  return { request, text, firstToken, totalMs: performance.now() - started, metrics };
}

const tags = await api('/api/tags'), version = await api('/api/version');
for (const model of models) if (!tags.models.some(x => x.name === model)) throw new Error(`Model not installed: ${model}`);
let gpu = 'unavailable';
try { gpu = execFileSync('nvidia-smi', ['--query-gpu=name,memory.total,driver_version', '--format=csv,noheader'], { encoding: 'utf8', windowsHide: true }).trim(); } catch {}
const metadata = { run_id: runId, started_at: new Date().toISOString(), ollama: version, node: process.version, os: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0]?.model, ram_bytes: os.totalmem(), gpu, models: tags.models.filter(x => models.includes(x.name)), dataset_sha256: createHash('sha256').update(JSON.stringify(cases)).digest('hex'), prompt_source_sha256: createHash('sha256').update(readFileSync('src/ollama.ts')).digest('hex'), repetitions, cases: cases.length, parameters: { temperature: .3, num_ctx: 4096, num_predict: 512, seeds: Array.from({ length: repetitions }, (_, i) => 42 + i), think: false }, method: 'Blocked order reversed each repetition; one model loaded at a time; explicit unload, preload, one excluded warmup per block; seeded shuffle; raw and application-postprocessed outputs; direct loopback API; no sending.', feedback_source: 'Agent review and deterministic checks, not human participant feedback; historical CSV analyzed separately.' };
writeFileSync(join(output, 'metadata.json'), JSON.stringify(metadata, null, 2));
writeFileSync('benchmarks/results/latest.json', JSON.stringify({ run_id: runId, directory: `benchmarks/results/${runId}` }, null, 2));
console.log(JSON.stringify({ event: 'start', run_id: runId, directory: output, trials: repetitions * cases.length * models.length }));

function shuffle(items, seed) {
  const copy = [...items]; let state = seed;
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}

for (let repetition = 0; repetition < repetitions; repetition++) {
  const order = repetition % 2 === 0 ? models : [...models].reverse();
  for (const model of order) {
    const pending = shuffle(cases, 100 + repetition).filter(sample => !seen.has(`${model}|${sample.id}|${repetition + 1}`));
    if (!pending.length) continue;
    // Sequential unload avoids competing for this laptop's 6 GiB VRAM.
    for (const installed of (await api('/api/ps')).models ?? []) await api('/api/generate', { model: installed.name, keep_alive: 0 });
    const loadStart = performance.now();
    const load = await api('/api/generate', { model, keep_alive: '30m', options: { num_ctx: 4096 } });
    const loadMs = performance.now() - loadStart;
    const warm = await generate(model, { ...cases[0], draft: 'hello, please confirm the meeting. thanks' }, 0);
    appendCsv(join(output, 'warmups.csv'), { model, repetition: repetition + 1, preload_ms: loadMs, ollama_load_ms: (load.load_duration ?? 0) / 1e6, warmup_total_ms: warm.totalMs, excluded_from_results: true, ps: JSON.stringify(await api('/api/ps')) });
    console.log(JSON.stringify({ event: 'block', model, repetition: repetition + 1, preload_ms: Math.round(loadMs), pending: pending.length }));
    for (const sample of pending) {
      const trialId = `${model}|${sample.id}|${repetition + 1}`;
      const stamp = new Date().toISOString();
      try {
        const result = await generate(model, sample, 42 + repetition);
        const parsed = personalizeEmail(result.text, sample.recipientName, sample.senderName, detectLanguage(sample.draft));
        const final = `Subject: ${parsed.subject}\n\n${parsed.body}`;
        const missingRaw = missingFacts(sample.facts, result.text), missingFinal = missingFacts(sample.facts, final);
        const m = result.metrics;
        const row = { run_id: runId, trial_id: trialId, timestamp: stamp, model, case_id: sample.id, repetition: repetition + 1, language: sample.language, detected_language: detectLanguage(sample.draft), setting: sample.setting, tone: sample.tone, challenge: Boolean(sample.challenge), status: 'ok', seed: 42 + repetition, total_ms: result.totalMs, first_token_ms: result.firstToken, ollama_total_ms: (m.total_duration ?? 0) / 1e6, load_ms: (m.load_duration ?? 0) / 1e6, prompt_tokens: m.prompt_eval_count, generated_tokens: m.eval_count, tokens_per_second: m.eval_duration ? m.eval_count / m.eval_duration * 1e9 : '', done_reason: m.done_reason, fact_count: sample.facts.length, missing_raw: JSON.stringify(missingRaw), missing_final: JSON.stringify(missingFinal), raw_facts_preserved: missingRaw.length === 0, final_facts_preserved: missingFinal.length === 0, warnings: JSON.stringify(detailWarnings(sample.draft, final)), raw_output: result.text, final_output: final, error: '' };
        appendCsv(csvPath, row);
        appendFileSync(rawPath, JSON.stringify({ ...row, draft: sample.draft, facts: sample.facts, intent: sample.intent, request: result.request, ollama_metrics: m }) + '\n');
        seen.add(trialId);
        console.log(JSON.stringify({ event: 'trial', model, case_id: sample.id, repetition: repetition + 1, total_s: +(result.totalMs / 1000).toFixed(2), missing: missingFinal }));
      } catch (error) {
        const columns = ['run_id','trial_id','timestamp','model','case_id','repetition','language','detected_language','setting','tone','challenge','status','seed','total_ms','first_token_ms','ollama_total_ms','load_ms','prompt_tokens','generated_tokens','tokens_per_second','done_reason','fact_count','missing_raw','missing_final','raw_facts_preserved','final_facts_preserved','warnings','raw_output','final_output','error'];
        appendCsv(csvPath, { run_id: runId, trial_id: trialId, timestamp: stamp, model, case_id: sample.id, repetition: repetition + 1, language: sample.language, status: 'error', error: String(error) }, columns);
        console.log(JSON.stringify({ event: 'error', model, case_id: sample.id, error: String(error) }));
      }
    }
  }
}
metadata.completed_at = new Date().toISOString();
writeFileSync(join(output, 'metadata.json'), JSON.stringify(metadata, null, 2));
console.log(JSON.stringify({ event: 'complete', directory: output, completed: seen.size }));
