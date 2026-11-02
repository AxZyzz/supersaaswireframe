import { validateEnv } from './env.validation';

const KEY = 'a'.repeat(64);
const prod = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://x',
  REDIS_URL: 'redis://x',
  WEB_URL: 'https://app.example.com',
  API_URL: 'https://api.example.com',
  APP_ENCRYPTION_KEY: KEY,
  JWT_ACCESS_SECRET: 'x'.repeat(40),
  JWT_REFRESH_SECRET: 'y'.repeat(40),
};

describe('validateEnv', () => {
  it('dev only needs a database url', () => {
    expect(() => validateEnv({ DATABASE_URL: 'postgresql://x' })).not.toThrow();
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects a malformed encryption key in any env', () => {
    expect(() =>
      validateEnv({ DATABASE_URL: 'x', APP_ENCRYPTION_KEY: 'short' }),
    ).toThrow(/64 hex/);
  });

  it('accepts a complete production env', () => {
    expect(() => validateEnv(prod)).not.toThrow();
  });

  it('production rejects missing, placeholder and shared JWT secrets', () => {
    expect(() => validateEnv({ ...prod, JWT_ACCESS_SECRET: '' })).toThrow(
      /JWT_ACCESS_SECRET is required/,
    );
    expect(() =>
      validateEnv({ ...prod, JWT_REFRESH_SECRET: 'change-me-too' }),
    ).toThrow(/at least 32/);
    expect(() =>
      validateEnv({ ...prod, JWT_REFRESH_SECRET: prod.JWT_ACCESS_SECRET }),
    ).toThrow(/must differ/);
  });

  it('production forbids the mock email driver', () => {
    expect(() => validateEnv({ ...prod, EMAIL_DRIVER: 'mock' })).toThrow(
      /EMAIL_DRIVER/,
    );
  });
});
