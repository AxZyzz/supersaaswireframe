/**
 * Runs before every Jest suite. Tests must never depend on — or act on — a
 * developer's local .env: someone testing real Gmail/SMTP or Bedrock locally
 * would otherwise see sends fail (or, worse, go out for real). process.env
 * wins over the .env files ConfigModule loads, so these always apply.
 */
process.env.EMAIL_DRIVER = 'mock';
process.env.AI_DRIVER = 'mock';
