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
