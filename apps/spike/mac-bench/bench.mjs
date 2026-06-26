#!/usr/bin/env node
// Phase-0 Mac bench for the Sona on-device spike.
// Times the LLM (SOAP generation) and STT (transcription) using llama.cpp +
// whisper.cpp, scores against ../thresholds.json, prints a table, writes results.json.
//
// Directional only — the binding GO/NO-GO is the on-phone run. A Mac (esp. Apple
// silicon) is FASTER than a phone, so: if it fails here, it fails on phone too;
// if it passes here, confirm on the phone before declaring GO.
//
// Usage:  bash setup.sh   then   node bench.mjs   [--model 7b|1.5b]

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const thresholds = JSON.parse(readFileSync(join(here, '..', 'thresholds.json'), 'utf8'));

const which = (process.argv.find(a => a === '7b' || a === '1.5b')
  || (process.argv.includes('--model') ? process.argv[process.argv.indexOf('--model') + 1] : '7b'));

const MODELS = {
  '7b':   join(here, 'models', 'Qwen2.5-7B-Instruct-Q4_K_M.gguf'),
  '1.5b': join(here, 'models', 'Qwen2.5-1.5B-Instruct-Q4_K_M.gguf'),
};
const WHISPER = existsSync(join(here, 'models', 'ggml-large-v3-turbo.bin'))
  ? join(here, 'models', 'ggml-large-v3-turbo.bin')
  : join(here, 'models', 'ggml-small.bin');
const AUDIO = join(here, 'audio', 'consult-01.wav');
const TRANSCRIPT = readFileSync(join(here, '..', 'fixtures', 'consult-01.raw.txt'), 'utf8');

const SOAP_PROMPT =
  `You are a clinical scribe. From the consult transcript below, write a concise SOAP note ` +
  `(Subjective, Objective, Assessment with ICD-10 codes, Plan). Extract medication doses verbatim; ` +
  `never invent doses.\n\nTRANSCRIPT:\n${TRANSCRIPT}\n\nSOAP NOTE:\n`;

const results = { when: new Date().toISOString?.() ?? 'n/a', model: which, stages: {} };
const row = (name, val, pass) => ({ name, val, pass });
const rows = [];

// ---------- LLM ----------
function benchLLM() {
  const model = MODELS[which];
  if (!existsSync(model)) { rows.push(row('LLM', 'model missing — run setup.sh', false)); return; }
  // llama-bench is non-interactive and always exits; -o json = clean parse. (-ngl 99 = Metal GPU)
  const r = spawnSync('llama-bench', ['-m', model, '-p', '512', '-n', '128', '-ngl', '99', '-o', 'json'],
    { encoding: 'utf8', input: '', timeout: 300000, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) { rows.push(row('LLM', `error: ${r.error.message}`, false)); return; }
  let tps = NaN, pp = NaN;
  try {
    const j = JSON.parse(r.stdout);
    const tg = j.find(e => (e.n_gen | 0) > 0 && (e.n_prompt | 0) === 0) || j.find(e => (e.n_gen | 0) > 0);
    const ppr = j.find(e => (e.n_prompt | 0) > 0 && (e.n_gen | 0) === 0);
    tps = tg ? tg.avg_ts : NaN;
    pp = ppr ? ppr.avg_ts : NaN;
  } catch (e) { rows.push(row('LLM', 'parse fail: ' + ((r.stderr || '') + (r.stdout || '')).slice(0, 100), false)); return; }
  const soapSec = !isNaN(tps) ? 400 / tps : NaN;   // a SOAP note ≈ 400 generated tokens
  const pass = (!isNaN(tps) && tps >= thresholds.llm.minTokensPerSec) && (soapSec <= thresholds.llm.maxSecondsSoap);
  results.stages.llm = { genTokensPerSec: +(+tps).toFixed(1), promptTokensPerSec: +(+pp).toFixed(1), estSoapSeconds: +soapSec.toFixed(1) };
  rows.push(row('LLM', `${isNaN(tps) ? '?' : tps.toFixed(1)} tok/s gen · ~${soapSec.toFixed(0)}s/SOAP`, pass));
}

// ---------- STT ----------
function benchSTT() {
  if (!existsSync(AUDIO)) { rows.push(row('STT', 'no audio/consult-01.wav (see setup.sh)', null)); return; }
  if (!existsSync(WHISPER)) { rows.push(row('STT', 'whisper model missing', false)); return; }
  const t0 = performance.now();
  const r = spawnSync('whisper-cli', ['-m', WHISPER, '-f', AUDIO, '-l', 'auto'], { encoding: 'utf8', input: '', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  const wall = (performance.now() - t0) / 1000;
  if (r.error) { rows.push(row('STT', `error: ${r.error.message}`, false)); return; }
  // crude clip-duration probe (afinfo on macOS); default assume ~60s if unknown
  const info = spawnSync('afinfo', [AUDIO], { encoding: 'utf8' });
  const dur = parseFloat((String(info.stdout || '').match(/estimated duration:\s*([\d.]+)/) || [])[1] || '60');
  const norm60 = wall * (60 / Math.max(dur, 1));            // seconds to process a 60s clip
  const pass = norm60 <= thresholds.stt.maxSecondsPer60sClip;
  results.stages.stt = { clipSeconds: +dur.toFixed(1), processSeconds: +wall.toFixed(1), per60sClip: +norm60.toFixed(1) };
  rows.push(row('STT', `${wall.toFixed(1)}s for ${dur.toFixed(0)}s clip (≈${norm60.toFixed(0)}s/60s)`, pass));
}

// ---------- run ----------
console.log(`\n  Sona spike — Mac Phase-0 bench  (model: ${which})\n`);
benchLLM();
benchSTT();

const pad = (s, n) => String(s).padEnd(n);
console.log('  ' + pad('STAGE', 12) + pad('RESULT', 44) + 'PASS');
console.log('  ' + '─'.repeat(62));
for (const r of rows) {
  const mark = r.pass === null ? '—' : r.pass ? '✓' : '✗';
  console.log('  ' + pad(r.name, 12) + pad(r.val, 44) + mark);
}

const hard = rows.filter(r => r.pass !== null);
const verdict = hard.length && hard.every(r => r.pass) ? 'GO (directional — confirm on phone)' : 'NEEDS WORK';
results.verdict = verdict;
console.log('  ' + '─'.repeat(62));
console.log('  VERDICT: ' + verdict + '\n');
console.log('  Notes: Mac > phone in speed. PII recall + RAM + 5-run stability are measured on the phone harness, not here.\n');

writeFileSync(join(here, 'results.json'), JSON.stringify(results, null, 2));
console.log('  Wrote results.json — send it back for the decision record.\n');
