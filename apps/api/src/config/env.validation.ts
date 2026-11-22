/**
 * Boot-time env check, wired into ConfigModule.forRoot({ validate }). Fails
 * fast with every problem listed at once, instead of a half-working API that
 * signs tokens with a dev secret or dies on the first DB query.
 *
 * Dev/test stay lenient (code keeps its local fallbacks); production is strict.
 */
const PLACEHOLDERS = ['change-me', 'change-me-too', 'changeme', 'secret'];

export function validateEnv(
  env: Record<string, unknown>,
): Record<string, unknown> {
  const str = (k: string) => (typeof env[k] === 'string' ? env[k].trim() : '');
  const errors: string[] = [];

  if (!str('DATABASE_URL')) errors.push('DATABASE_URL is required');

  const key = str('APP_ENCRYPTION_KEY');
  if (key && !/^[0-9a-fA-F]{64}$/.test(key)) {
    errors.push('APP_ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
  }

  if (
    str('SIGNUP_MODE') &&
    !['open', 'waitlist'].includes(str('SIGNUP_MODE'))
  ) {
    errors.push('SIGNUP_MODE must be "open" or "waitlist"');
  }

  // Gemini (google-stack): fail at boot, not on the first AI request.
  if (str('AI_DRIVER') === 'gemini') {
    if (str('GEMINI_USE_VERTEX') === 'true') {
      if (!str('GOOGLE_CLOUD_PROJECT')) {
        errors.push('AI_DRIVER=gemini on Vertex AI needs GOOGLE_CLOUD_PROJECT');
      }
    } else if (!str('GEMINI_API_KEY')) {
      errors.push('AI_DRIVER=gemini needs GEMINI_API_KEY (Google AI Studio)');
    }
  }

  // Discover driver (T10): the agent needs an address and the identity it may call back with.
  const dd = str('DISCOVER_DRIVER').toLowerCase();
  if (dd && !['native', 'agent'].includes(dd)) {
    errors.push('DISCOVER_DRIVER must be "native" or "agent"');
  }
  if (dd === 'agent') {
    for (const k of [
      'DISCOVER_AGENT_URL',
      'AGENT_TOOLS_AUDIENCE',
      'AGENT_TOOLS_SA_EMAIL',
    ]) {
      if (!str(k)) errors.push(`DISCOVER_DRIVER=agent needs ${k}`);
    }
  }

  // Insights source (T07): BigQuery needs a project to bill and read from.
  const is = str('INSIGHTS_SOURCE').toLowerCase();
  if (is && !['postgres', 'bigquery'].includes(is)) {
    errors.push('INSIGHTS_SOURCE must be "postgres" or "bigquery"');
  }
  if (
    is === 'bigquery' &&
    !str('BIGQUERY_PROJECT') &&
    !str('GOOGLE_CLOUD_PROJECT')
  ) {
    errors.push(
      'INSIGHTS_SOURCE=bigquery needs BIGQUERY_PROJECT (or GOOGLE_CLOUD_PROJECT)',
    );
  }

  // Playbook memory (T14): vector search needs somewhere to bill and a way to embed.
  const ps = str('PLAYBOOK_SEARCH').toLowerCase();
  if (ps && !['postgres', 'bigquery'].includes(ps)) {
    errors.push('PLAYBOOK_SEARCH must be "postgres" or "bigquery"');
  }
  const ed = str('EMBEDDING_DRIVER').toLowerCase();
  if (ed && !['gemini', 'mock'].includes(ed)) {
    errors.push('EMBEDDING_DRIVER must be "gemini" or "mock"');
  }
  if (ps === 'bigquery') {
    if (!str('BIGQUERY_PROJECT') && !str('GOOGLE_CLOUD_PROJECT')) {
      errors.push(
        'PLAYBOOK_SEARCH=bigquery needs BIGQUERY_PROJECT (or GOOGLE_CLOUD_PROJECT)',
      );
    }
    const embedsWithGemini = ed
      ? ed === 'gemini'
      : str('AI_DRIVER') === 'gemini';
    if (
      embedsWithGemini &&
      str('EMBEDDINGS_USE_VERTEX') !== 'true' &&
      !str('GEMINI_API_KEY')
    ) {
      errors.push(
        'PLAYBOOK_SEARCH=bigquery with Gemini embeddings needs GEMINI_API_KEY or EMBEDDINGS_USE_VERTEX=true',
      );
    }
  }

  // Scheduled jobs (T13): CRON_MODE=scheduler hands the loop jobs to Cloud
  // Scheduler, which can only call in with a verifiable identity.
  const cm = str('CRON_MODE').toLowerCase();
  if (cm && !['internal', 'scheduler'].includes(cm)) {
    errors.push('CRON_MODE must be "internal" or "scheduler"');
  }
  if (cm === 'scheduler' && (!str('CRON_AUDIENCE') || !str('CRON_SA_EMAIL'))) {
    errors.push('CRON_MODE=scheduler needs CRON_AUDIENCE and CRON_SA_EMAIL');
  }
  if (str('TRACING') && !['on', 'off'].includes(str('TRACING').toLowerCase())) {
    errors.push('TRACING must be "on" or "off"');
  }

  // ADK agents (T09): a switch set to "agent" needs the agent's address.
  const re = str('REVIEW_EXPLAINER').toLowerCase();
  if (re && !['template', 'agent', 'gemini'].includes(re)) {
    errors.push('REVIEW_EXPLAINER must be "template", "agent" or "gemini"');
  }
  if (re === 'agent' && !str('REVIEW_ANALYST_URL')) {
    errors.push('REVIEW_EXPLAINER=agent needs REVIEW_ANALYST_URL');
  }
  const cd = str('COPYWRITER_DRIVER').toLowerCase();
  if (cd && !['gemini', 'agent', 'mock'].includes(cd)) {
    errors.push('COPYWRITER_DRIVER must be "gemini", "agent" or "mock"');
  }
  if (cd === 'agent' && !str('COPYWRITER_URL')) {
    errors.push('COPYWRITER_DRIVER=agent needs COPYWRITER_URL');
  }

  // Model Armor (T08): needs a template to call.
  if (
    str('SAFETY_DRIVER') &&
    !['off', 'modelarmor'].includes(str('SAFETY_DRIVER'))
  ) {
    errors.push('SAFETY_DRIVER must be "off" or "modelarmor"');
  }
  if (str('SAFETY_DRIVER') === 'modelarmor') {
    if (!str('MODEL_ARMOR_TEMPLATE')) {
      errors.push('SAFETY_DRIVER=modelarmor needs MODEL_ARMOR_TEMPLATE');
    }
    if (
      !str('MODEL_ARMOR_TEMPLATE').startsWith('projects/') &&
      !str('GOOGLE_CLOUD_PROJECT')
    ) {
      errors.push(
        'SAFETY_DRIVER=modelarmor needs GOOGLE_CLOUD_PROJECT (or a full projects/... template name)',
      );
    }
  }
  if (
    str('SAFETY_FAIL_MODE') &&
    !['open', 'closed'].includes(str('SAFETY_FAIL_MODE'))
  ) {
    errors.push('SAFETY_FAIL_MODE must be "open" or "closed"');
  }

  if (
    str('COOKIE_SAMESITE') &&
    !['lax', 'strict', 'none'].includes(str('COOKIE_SAMESITE'))
  ) {
    errors.push('COOKIE_SAMESITE must be "lax", "strict" or "none"');
  }

  if (str('NODE_ENV') === 'production') {
    for (const k of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
      const v = str(k);
      if (!v) errors.push(`${k} is required in production`);
      else if (v.length < 32 || PLACEHOLDERS.includes(v.toLowerCase())) {
        errors.push(`${k} must be a random value of at least 32 chars`);
      }
    }
    if (
      str('JWT_ACCESS_SECRET') &&
      str('JWT_ACCESS_SECRET') === str('JWT_REFRESH_SECRET')
    ) {
      errors.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
    }
    if (!key) errors.push('APP_ENCRYPTION_KEY is required in production');
    for (const k of ['WEB_URL', 'API_URL', 'REDIS_URL']) {
      if (!str(k)) errors.push(`${k} is required in production`);
    }
    if (str('THROTTLE_DISABLED') === 'true') {
      errors.push('THROTTLE_DISABLED is a test-only switch');
    }
    if (str('EMAIL_DRIVER') === 'mock') {
      errors.push('EMAIL_DRIVER=mock is not allowed in production');
    }
  }

  if (errors.length) {
    throw new Error(`Invalid environment:\n  - ${errors.join('\n  - ')}`);
  }
  return env;
}
