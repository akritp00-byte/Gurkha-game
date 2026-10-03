import { existsSync } from 'node:fs';

/**
 * Loads local settings from the repo-root .env (copy .env.example to create it).
 * index.ts imports this first, so values are in place before any other module reads them.
 * Variables already set in the real environment take precedence over the file.
 */
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(envFile);
