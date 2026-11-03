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
