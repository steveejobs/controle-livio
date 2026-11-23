import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const loopback = new Set(['127.0.0.1', 'localhost', '::1']);
function localUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !loopback.has(url.hostname)) throw new Error('Nonlocal URL');
  return url;
}
if (
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.RUNNER_OS !== 'Linux' ||
  process.env.SUPABASE_LOCAL !== 'true' ||
  process.env.SUPABASE_ENVIRONMENT !== 'test' ||
  process.env.LIVIO_AUTH_OTP_EXPIRY_SECONDS !== '60' ||
  !process.env.RUNNER_TEMP ||
  existsSync('supabase/.temp/project-ref') ||
  process.env.SUPABASE_ACCESS_TOKEN ||
  process.env.SUPABASE_DB_PASSWORD
) {
  console.error('SMTP capture blocked: disposable Linux CI configuration required.');
  process.exit(1);
}

let phase = 'validate-local-destinations';
const checks = {};
const started = Date.now();
const evidencePath = join(process.env.RUNNER_TEMP, 'livio-integrated-artifacts');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function requireCheck(value) {
  if (!value) throw new Error('Validation failed');
}
function evidence(status) {
  mkdirSync(evidencePath, { recursive: true });
  writeFileSync(
    join(evidencePath, 'smtp-capture-validation.json'),
    JSON.stringify(
      {
        status,
        phase,
        checks,
        elapsedMs: Date.now() - started,
        scope: 'Disposable Auth and local Mailpit; no hosted SMTP provider or real recipient.',
        hostedProviderVerified: false,
        frontendLandingVerified: false,
      },
      null,
      2,
    ) + '\n',
  );
}

try {
  const authUrl = localUrl(process.env.SUPABASE_URL);
  const mailUrl = localUrl(process.env.LIVIO_MAILPIT_URL);
  const redirect = localUrl(process.env.SUPABASE_AUTH_REDIRECT_URL);
  requireCheck(authUrl.port === '54321' && mailUrl.port === '54324' && redirect.port === '3010');
  const options = {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  };
  const admin = createClient(authUrl.href, process.env.SUPABASE_SERVICE_ROLE_KEY, options);
  const client = () => createClient(authUrl.href, process.env.SUPABASE_ANON_KEY, options);
  const email = `smtp-qa-${randomUUID()}@example.test`;
  const firstPassword = `LocalOnly-A-${randomUUID()}!`;
  const nextPassword = `LocalOnly-B-${randomUUID()}!`;
  const observed = new Set();

  async function capturedLink(type) {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const response = await fetch(new URL('/api/v1/messages?limit=100', mailUrl), {
        signal: AbortSignal.timeout(5000),
      });
      requireCheck(response.ok);
      const data = await response.json();
      for (const message of data.messages ?? []) {
        if (observed.has(message.ID) || !message.To?.some((to) => to.Address === email)) continue;
        requireCheck(/^[A-Za-z0-9-]+$/.test(message.ID));
        const detailResponse = await fetch(new URL(`/api/v1/message/${message.ID}`, mailUrl), {
          signal: AbortSignal.timeout(5000),
        });
        requireCheck(detailResponse.ok);
        const detail = await detailResponse.json();
        const content = `${detail.HTML ?? ''}\n${detail.Text ?? ''}`.replaceAll('&amp;', '&');
        for (const match of content.matchAll(/https?:\/\/[^\s"'<>]+/g)) {
          const link = new URL(match[0]);
          if (
            link.origin === authUrl.origin &&
            link.pathname === '/auth/v1/verify' &&
            link.searchParams.get('type') === type
          ) {
            requireCheck(Boolean(link.searchParams.get('token')));
            const destination = localUrl(link.searchParams.get('redirect_to'));
            requireCheck(
              destination.origin === redirect.origin && destination.pathname === redirect.pathname,
            );
            observed.add(message.ID);
            return link;
          }
        }
      }
      await delay(250);
    }
    throw new Error('Capture timed out');
  }
  async function consume(link, expectSuccess = true) {
    requireCheck(link.origin === authUrl.origin);
    const response = await fetch(link, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
    requireCheck(response.status === 302 || response.status === 303);
    const location = localUrl(response.headers.get('location'));
    const params = new URLSearchParams(location.hash.slice(1));
    if (!expectSuccess) {
      requireCheck(
        !params.has('access_token') && Boolean(params.get('error') || params.get('error_code')),
      );
      return null;
    }
    requireCheck(
      location.origin === redirect.origin &&
        Boolean(params.get('access_token')) &&
        Boolean(params.get('refresh_token')),
    );
    const sessionClient = client();
    const result = await sessionClient.auth.setSession({
      access_token: params.get('access_token'),
      refresh_token: params.get('refresh_token'),
    });
    requireCheck(!result.error && result.data.user?.email === email);
    return sessionClient;
  }

  phase = 'deliver-and-use-invitation';
  const invitation = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: redirect.href });
  requireCheck(!invitation.error && invitation.data.user?.email === email);
  const invitationLink = await capturedLink('invite');
  checks.invitationCaptured = true;
  const invited = await consume(invitationLink);
  const passwordResult = await invited.auth.updateUser({ password: firstPassword });
  requireCheck(!passwordResult.error);
  await invited.auth.signOut();
  const login = await client().auth.signInWithPassword({ email, password: firstPassword });
  requireCheck(!login.error);
  await consume(invitationLink, false);
  checks.invitationLoginAndSingleUse = true;

  phase = 'deliver-and-use-recovery';
  const recovery = await client().auth.resetPasswordForEmail(email, { redirectTo: redirect.href });
  requireCheck(!recovery.error);
  const recoveryLink = await capturedLink('recovery');
  checks.recoveryCaptured = true;
  const recovered = await consume(recoveryLink);
  const changed = await recovered.auth.updateUser({ password: nextPassword });
  requireCheck(!changed.error);
  await recovered.auth.signOut();
  const oldLogin = await client().auth.signInWithPassword({ email, password: firstPassword });
  const newLogin = await client().auth.signInWithPassword({ email, password: nextPassword });
  requireCheck(Boolean(oldLogin.error) && !newLogin.error);
  await consume(recoveryLink, false);
  checks.recoveryPasswordChangeAndSingleUse = true;

  phase = 'verify-expiration-without-changing-server-clock';
  const expiring = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: redirect.href },
  });
  requireCheck(!expiring.error && Boolean(expiring.data.properties?.action_link));
  const expiringLink = localUrl(expiring.data.properties.action_link);
  await delay(65_000);
  await consume(expiringLink, false);
  checks.expirationEnforced = true;
  checks.linksRemainOnAllowedLoopbackDestination = true;
  phase = 'complete';
  evidence('PASS');
  console.log(
    'SMTP capture PASS: invitation, recovery, password, replay, expiration and local links verified.',
  );
} catch {
  evidence('INCOMPLETE');
  // Auth responses, MIME bodies, tokens and error stacks must never enter artifacts/logs.
  console.error(`SMTP capture validation failed at ${phase}.`);
  process.exitCode = 1;
}
