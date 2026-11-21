// Safety screening for untrusted text going INTO the AI (web pages Discover
// reads, inbound replies) and for AI text going OUT to people. The default
// does nothing; SAFETY_DRIVER=modelarmor turns on Google Cloud Model Armor.
export type SafetyInputContext = 'web_page' | 'inbound_reply' | 'user_prompt';
export type SafetyVerdictKind = 'ok' | 'blocked' | 'flagged';

export interface SafetyFinding {
  /** e.g. pi_and_jailbreak, sdp, malicious_uris, rai, csam */
  filter: string;
}

export interface SafetyResult {
  verdict: SafetyVerdictKind;
  findings: SafetyFinding[];
  provider: string;
}

export interface SafetyScreen {
  readonly name: string;
  screenInput(text: string, context: SafetyInputContext): Promise<SafetyResult>;
  /** `context` is the AI task whose output is being shown (e.g. reply_draft). */
  screenOutput(text: string, context: string): Promise<SafetyResult>;
}

/** DI token for the active SafetyScreen. */
export const SAFETY_SCREEN = Symbol('SAFETY_SCREEN');

export class NoopSafetyScreen implements SafetyScreen {
  readonly name = 'off';
  screenInput(): Promise<SafetyResult> {
    return Promise.resolve({
      verdict: 'ok',
      findings: [],
      provider: this.name,
    });
  }
  screenOutput(): Promise<SafetyResult> {
    return Promise.resolve({
      verdict: 'ok',
      findings: [],
      provider: this.name,
    });
  }
}

// ── structured logging (Cloud Logging reads one JSON line per entry) ─────
type Sink = (line: string) => void;
let sink: Sink = (l) => process.stdout.write(`${l}\n`);
export function setSafetyLogSink(s: Sink | null) {
  sink = s ?? ((l) => process.stdout.write(`${l}\n`));
}
export function safetyLog(
  severity: 'INFO' | 'WARNING' | 'ERROR',
  fields: Record<string, unknown>,
) {
  sink(JSON.stringify({ severity, ...fields }));
}

// ── chunking: only the text we actually send gets screened ───────────────
export const DEFAULT_CHUNK_CHARS = 30_000;

/** Chunks overlap a little so an injection phrase can't hide on a boundary. */
const CHUNK_OVERLAP = 200;

export function chunkText(text: string, size = DEFAULT_CHUNK_CHARS): string[] {
  if (text.length <= size) return [text];
  const step = size - Math.min(CHUNK_OVERLAP, Math.floor(size / 4));
  const out: string[] = [];
  for (let i = 0; ; i += step) {
    out.push(text.slice(i, i + size));
    if (i + size >= text.length) break;
  }
  return out;
}

const RANK: Record<SafetyVerdictKind, number> = {
  ok: 0,
  flagged: 1,
  blocked: 2,
};

/** Screens every chunk (stops at the first block); worst verdict wins. */
export async function screenInputChunked(
  screen: SafetyScreen,
  text: string,
  context: SafetyInputContext,
  size = DEFAULT_CHUNK_CHARS,
): Promise<SafetyResult> {
  let worst: SafetyResult = {
    verdict: 'ok',
    findings: [],
    provider: screen.name,
  };
  for (const chunk of chunkText(text, size)) {
    const r = await screen.screenInput(chunk, context);
    if (RANK[r.verdict] > RANK[worst.verdict]) {
      worst = { ...r, findings: [...worst.findings, ...r.findings] };
    } else {
      worst.findings.push(...r.findings);
    }
    if (worst.verdict === 'blocked') break;
  }
  return worst;
}
