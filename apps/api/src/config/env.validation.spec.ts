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

  it('AI_DRIVER=gemini needs a key, or a project on Vertex AI', () => {
    const dev = { DATABASE_URL: 'x', AI_DRIVER: 'gemini' };
    expect(() => validateEnv(dev)).toThrow(/GEMINI_API_KEY/);
    expect(() => validateEnv({ ...dev, GEMINI_API_KEY: 'k' })).not.toThrow();
    expect(() => validateEnv({ ...dev, GEMINI_USE_VERTEX: 'true' })).toThrow(
      /GOOGLE_CLOUD_PROJECT/,
    );
    expect(() =>
      validateEnv({
        ...dev,
        GEMINI_USE_VERTEX: 'true',
        GOOGLE_CLOUD_PROJECT: 'p',
      }),
    ).not.toThrow();
  });

  it('T07: INSIGHTS_SOURCE is postgres or bigquery, and bigquery needs a project', () => {
    const dev = { DATABASE_URL: 'x' };
    expect(() =>
      validateEnv({ ...dev, INSIGHTS_SOURCE: 'postgres' }),
    ).not.toThrow();
    expect(() => validateEnv({ ...dev, INSIGHTS_SOURCE: 'excel' })).toThrow(
      /INSIGHTS_SOURCE must be/,
    );
    expect(() => validateEnv({ ...dev, INSIGHTS_SOURCE: 'bigquery' })).toThrow(
      /BIGQUERY_PROJECT/,
    );
    expect(() =>
      validateEnv({
        ...dev,
        INSIGHTS_SOURCE: 'bigquery',
        GOOGLE_CLOUD_PROJECT: 'p',
      }),
    ).not.toThrow();
    expect(() =>
      validateEnv({
        ...dev,
        INSIGHTS_SOURCE: 'BigQuery',
        BIGQUERY_PROJECT: 'p',
      }),
    ).not.toThrow();
  });

  it('T09: agent switches need their address, and reject unknown values', () => {
    const dev = { DATABASE_URL: 'x' };
    expect(() => validateEnv({ ...dev, REVIEW_EXPLAINER: 'agent' })).toThrow(
      /REVIEW_ANALYST_URL/,
    );
    expect(() =>
      validateEnv({
        ...dev,
        REVIEW_EXPLAINER: 'agent',
        REVIEW_ANALYST_URL: 'http://localhost:8101',
      }),
    ).not.toThrow();
    expect(() => validateEnv({ ...dev, COPYWRITER_DRIVER: 'agent' })).toThrow(
      /COPYWRITER_URL/,
    );
    expect(() => validateEnv({ ...dev, REVIEW_EXPLAINER: 'robot' })).toThrow(
      /REVIEW_EXPLAINER must be/,
    );
    // blank values (as in .env.example) mean "off"
    expect(() =>
      validateEnv({ ...dev, REVIEW_EXPLAINER: '', COPYWRITER_DRIVER: '' }),
    ).not.toThrow();
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
