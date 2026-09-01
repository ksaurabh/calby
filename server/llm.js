// Every Claude call goes through here, so usage and cost are recorded in one
// place rather than at five call sites that could drift apart.
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const USAGE_FILE = join(dirname(fileURLToPath(import.meta.url)), 'llm-usage.json');
const RETENTION_DAYS = 90;

// US dollars per million tokens. Cache reads are a tenth of the input rate and
// cache writes a quarter more, per Anthropic's pricing.
const PRICING = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-haiku-4-5': { input: 1, output: 5 },
};
const DEFAULT_PRICING = PRICING['claude-opus-5'];
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export function priceFor(model) {
  return PRICING[model] || DEFAULT_PRICING;
}

/** Cost in USD for one response's usage block. */
export function costOf(model, usage = {}) {
  const price = priceFor(model);
  const input = usage.input_tokens || 0;
  const output = usage.output_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;

  return (
    (input * price.input +
      output * price.output +
      cacheWrite * price.input * CACHE_WRITE_MULTIPLIER +
      cacheRead * price.input * CACHE_READ_MULTIPLIER) / 1_000_000
  );
}

// ---------------------------------------------------------------------------
// Usage log
// ---------------------------------------------------------------------------
let entries = loadEntries();
let saveTimer = null;

function loadEntries() {
  try {
    if (!existsSync(USAGE_FILE)) return [];
    return JSON.parse(readFileSync(USAGE_FILE, 'utf-8')).entries || [];
  } catch {
    return [];
  }
}

function writeEntries() {
  try {
    const cutoff = Date.now() - RETENTION_DAYS * 86400_000;
    entries = entries.filter(e => Date.parse(e.at) >= cutoff);
    writeFileSync(USAGE_FILE, JSON.stringify({ entries }, null, 2));
  } catch (err) {
    console.error('[llm] could not write the usage log:', err.message);
  }
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    writeEntries();
  }, 500);
  saveTimer.unref?.();
}

function flush() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  writeEntries();
}

process.on('exit', flush);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    flush();
    process.exit(0);
  });
}

export function recordUsage({ model, usage, feature, email, keySource }) {
  const entry = {
    at: new Date().toISOString(),
    email: email?.toLowerCase() || null,
    domain: email?.split('@')[1]?.toLowerCase() || null,
    feature,
    model,
    keySource: keySource || null,
    input: usage?.input_tokens || 0,
    output: usage?.output_tokens || 0,
    cacheWrite: usage?.cache_creation_input_tokens || 0,
    cacheRead: usage?.cache_read_input_tokens || 0,
    costUsd: costOf(model, usage),
  };
  entries.push(entry);
  scheduleSave();
  return entry;
}

export function usageEntries() {
  return entries;
}

/**
 * One Claude call, with its cost recorded. `feature` labels what it was for and
 * shows up in the cost breakdown; `email` attributes it to a user.
 */
export async function callClaude(params, { apiKey, feature, email, keySource } = {}) {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create(params);
  recordUsage({ model: response.model || params.model, usage: response.usage, feature, email, keySource });
  return response;
}
