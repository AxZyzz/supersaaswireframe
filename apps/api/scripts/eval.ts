/**
 * AI eval runner (T6.7). Runs the labelled eval set through the configured
 * provider and prints a scorecard; writes a JSON report to evals-results/.
 *
 *   npm run eval -w apps/api                     # uses AI_DRIVER from .env
 *   AI_DRIVER=bedrock npm run eval -w apps/api -- --min-accuracy=0.85
 *
 * With AI_DRIVER=mock it only proves the pipeline (the mock always answers
 * the first class). Real quality numbers need Bedrock credentials.
 */
import { ConfigService } from '@nestjs/config';
import { config } from 'dotenv';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { checkSequence, scoreClassification } from '../src/ai/evals/evaluate';
import { CLASSIFY_CASES, SEQUENCE_CASES } from '../src/ai/evals/fixtures';
import { classifyReply, PROMPT_VERSIONS, sequencePrompt } from '../src/ai/prompts';
import { BedrockAIProvider } from '../src/ai/providers/bedrock.provider';
import { MockAIProvider } from '../src/ai/providers/mock.provider';
import { AIProviderResolver } from '../src/ai/providers/provider.resolver';

config({ path: ['.env', '../../.env'] });

async function main() {
  const minArg = process.argv.find((a) => a.startsWith('--min-accuracy='));
  const minAccuracy = minArg ? Number(minArg.split('=')[1]) : null;

  const cfg = new ConfigService(process.env);
  const provider = new AIProviderResolver(
    cfg,
    new MockAIProvider(),
    new BedrockAIProvider(cfg),
  ).resolve();
  console.log(`Provider: ${provider.name}  ·  prompts: ${JSON.stringify(PROMPT_VERSIONS)}\n`);

  // ── reply classification ──
  const predictions: Record<string, string | null> = {};
  let tokens = 0;
  for (const c of CLASSIFY_CASES) {
    try {
      const r = await provider.generate(classifyReply({ replyBody: c.reply, subject: c.subject }));
      tokens += r.usage.inputTokens + r.usage.outputTokens;
      predictions[c.id] = (JSON.parse(r.text) as { classification?: string }).classification ?? null;
    } catch (err) {
      predictions[c.id] = null;
      console.warn(`  ${c.id}: ${(err as Error).message}`);
    }
  }
  const cls = scoreClassification(CLASSIFY_CASES, predictions);
  console.log(`Reply classification: ${(cls.accuracy * 100).toFixed(1)}%  (${cls.correct}/${cls.total})`);
  for (const [k, v] of Object.entries(cls.byClass)) {
    console.log(`  ${k.padEnd(15)} ${v.correct}/${v.total}`);
  }
  if (cls.misses.length) {
    console.log('  misses:');
    for (const m of cls.misses) console.log(`    ${m.id}: expected ${m.expected}, got ${m.got}`);
  }

  // ── sequence generation ──
  const seqResults: { id: string; issues: string[] }[] = [];
  for (const c of SEQUENCE_CASES) {
    try {
      const r = await provider.generate(sequencePrompt(c));
      tokens += r.usage.inputTokens + r.usage.outputTokens;
      const steps = (JSON.parse(r.text) as { steps?: never[] }).steps ?? [];
      seqResults.push({ id: c.id, issues: checkSequence(c, steps) });
    } catch (err) {
      seqResults.push({ id: c.id, issues: [(err as Error).message] });
    }
  }
  const seqPass = seqResults.filter((r) => r.issues.length === 0).length;
  console.log(`\nSequence generation: ${seqPass}/${seqResults.length} pass all checks`);
  for (const r of seqResults.filter((x) => x.issues.length)) {
    console.log(`  ${r.id}: ${r.issues.join('; ')}`);
  }
  console.log(`\nTokens used: ${tokens.toLocaleString()}`);

  const dir = join(process.cwd(), 'evals-results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${provider.name}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      { provider: provider.name, prompts: PROMPT_VERSIONS, classification: cls, sequences: seqResults, tokens },
      null,
      2,
    ),
  );
  console.log(`Report: ${file}`);

  if (provider.name === 'mock') {
    console.log('\n(mock provider — pipeline check only, not a quality score)');
  } else if (minAccuracy !== null && cls.accuracy < minAccuracy) {
    console.error(`\nFAIL: accuracy ${cls.accuracy.toFixed(3)} < ${minAccuracy}`);
    process.exitCode = 1;
  }
}

void main();
