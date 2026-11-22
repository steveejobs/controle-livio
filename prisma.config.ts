import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const environmentFile = fileURLToPath(new URL('.env', import.meta.url));
if (existsSync(environmentFile)) loadEnvFile(environmentFile);

// Generation and validation work without a live database. Commands requiring
// a connection fail if DATABASE_URL is absent. Supabase owns migration history.
export default defineConfig({
  schema: 'packages/db/prisma/schema.prisma',
  datasource: { url: process.env.DATABASE_URL },
});
