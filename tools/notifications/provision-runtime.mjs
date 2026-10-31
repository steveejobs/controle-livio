import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import webPush from 'web-push';

const projectRef = process.env.SUPABASE_PROJECT_REF;
const environment = process.env.SUPABASE_ENVIRONMENT;
const verifiedProductionConnectedProjectRefs = new Set(['ioebcdpyrszokdyaoaqv']);
assert.ok(['development', 'staging'].includes(environment));
assert.ok(
  projectRef && verifiedProductionConnectedProjectRefs.has(projectRef),
  'Este provisionador grava segredos no Vercel Production e aceita somente a ref ligada à produção, verificada no painel.',
);
assert.equal(
  process.env.QA_PROJECT_REF,
  undefined,
  'Não execute o provisionador Vercel Production com configuração de QA carregada.',
);
assert.equal(projectRef, process.env.CONFIRM_SUPABASE_PROJECT_REF);
assert.ok(
  process.argv.includes('--apply') && process.argv.includes(`--confirm-project=${projectRef}`),
);
const localPath = 'apps/api/.env.scheduler-generated.local';
const cronSecret = randomBytes(48).toString('base64url');
const vapid = webPush.generateVAPIDKeys();
const values = {
  CRON_SECRET: cronSecret,
  VAPID_PUBLIC_KEY: vapid.publicKey,
  VAPID_PRIVATE_KEY: vapid.privateKey,
  VAPID_SUBJECT: 'https://controle-livio-web.vercel.app',
};

function addToVercel(name, value) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `vercel env add ${name} production --force --sensitive --yes --cwd apps/api`,
      ],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `Vercel rejeitou ${name} (${code}); ${output.includes('already exists') ? 'variável existente' : 'consulte o CLI'}.`,
            ),
          ),
    );
    child.stdin.end(value);
  });
}

writeFileSync(
  localPath,
  [
    `SUPABASE_PROJECT_REF=${projectRef}`,
    `SUPABASE_ENVIRONMENT=${process.env.SUPABASE_ENVIRONMENT}`,
    `CRON_SECRET=${cronSecret}`,
  ].join('\n') + '\n',
  { flag: 'wx', mode: 0o600 },
);
for (const [name, value] of Object.entries(values)) {
  await addToVercel(name, value);
  console.log(`${name}: configurada no ambiente Vercel production.`);
}
console.log(`Configuração local protegida em ${localPath}. Não compartilhe o conteúdo.`);
