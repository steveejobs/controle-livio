import { existsSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';

for (const file of ['.env', '.env.infrastructure']) {
  if (!existsSync(file)) continue;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    process.env[key] ??= value;
  }
}

const apply = process.argv.includes('--apply');
const projectRef = process.env.SUPABASE_PROJECT_REF;
const confirmation = process.argv
  .find((arg) => arg.startsWith('--confirm-project='))
  ?.split('=')[1];
if (!['development', 'test', 'staging'].includes(process.env.SUPABASE_ENVIRONMENT)) {
  throw new Error('Esta ferramenta aceita apenas desenvolvimento/homologação.');
}
if (apply && (!confirmation || confirmation !== projectRef)) {
  throw new Error(
    'Aplicar exige --confirm-project igual ao projeto de desenvolvimento confirmado.',
  );
}
const directUrl = process.env.DIRECT_URL;
if (
  !directUrl ||
  new URL(directUrl).port === '6543' ||
  !directUrl.includes(projectRef ?? 'invalid')
) {
  throw new Error(
    'Configure DIRECT_URL do pooler de sessão do projeto confirmado, sem porta 6543.',
  );
}

const privateValues = Object.entries(process.env)
  .filter(
    ([key, value]) =>
      value && /SECRET|TOKEN|PASSWORD|PRIVATE|DATABASE_URL|DIRECT_URL|SERVICE_ROLE/.test(key),
  )
  .map(([, value]) => value);
privateValues.push(new URL(directUrl).password, decodeURIComponent(new URL(directUrl).password));
const redact = (text) =>
  privateValues
    .filter(Boolean)
    .reduce((output, secret) => output.replaceAll(secret, '[REDACTED]'), text);

async function run(args) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { shell: false, windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      process.stdout.write(redact(output));
      if (code === 0) resolve();
      else reject(new Error('A operação falhou; nenhuma confirmação automática será tentada.'));
    });
  });
}

await run(['tools/supabase/safety.mjs', 'remote-migrate']);
await run([
  'node_modules/supabase/dist/supabase.js',
  'db',
  'push',
  '--db-url',
  directUrl,
  ...(apply ? ['--yes'] : ['--dry-run']),
]);
