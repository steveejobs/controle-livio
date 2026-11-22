import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Allowlisted facts only. Never persist CLI output, container env or health log text.
export function failureFacts(text = '') {
  return {
    dns: /no such host|EAI_AGAIN|getaddrinfo|failed to resolve|name resolution/i.test(text),
    imageDownload: /pull access denied|manifest unknown|failed to pull|toomanyrequests/i.test(text),
    docker: /cannot connect to.*docker|docker daemon.*not running/i.test(text),
    health: /unhealthy|health check|readiness/i.test(text),
    sql: /SQLSTATE|migration.*failed|syntax error at|permission denied for schema/i.test(text),
    sqlStates: [
      ...new Set(Array.from(text.matchAll(/SQLSTATE\s*[:=]?\s*([A-Z0-9]{5})\b/g), (m) => m[1])),
    ],
    observedHosts: ['ghcr.io', 'public.ecr.aws', 'registry-1.docker.io'].filter((h) =>
      text.includes(h),
    ),
  };
}

export function collectDiagnostics(phase, result, { env = process.env, run = spawnSync } = {}) {
  const command = (program, args) =>
    run(program, args, { encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 4e6 });
  const cli = command('npx', ['--no-install', 'supabase', '--version']);
  const dockerAllowed = !env.DOCKER_HOST && !env.DOCKER_CONTEXT && !env.DOCKER_TLS_VERIFY;
  const docker = dockerAllowed
    ? command('docker', ['version', '--format', '{{.Server.Version}}'])
    : {};
  const listed = dockerAllowed
    ? command('docker', ['ps', '-aq', '--filter', 'label=com.supabase.cli.project=livio-legal-crm'])
    : {};
  const ids = String(listed.stdout ?? '')
    .trim()
    .split(/\s+/)
    .filter((id) => /^[a-f0-9]{12,64}$/.test(id));
  const containers = [];
  for (const id of ids) {
    const inspected = command('docker', ['inspect', id]);
    let value;
    try {
      value = JSON.parse(inspected.stdout)[0];
    } catch {
      continue;
    }
    if (value?.Config?.Labels?.['com.supabase.cli.project'] !== 'livio-legal-crm') continue;
    const state = value.State ?? {};
    containers.push({
      id,
      name: /^\/supabase_[a-z0-9_-]+_livio-legal-crm$/.test(value.Name)
        ? value.Name
        : '[own project]',
      status: ['created', 'running', 'paused', 'restarting', 'removing', 'exited', 'dead'].includes(
        state.Status,
      )
        ? state.Status
        : 'UNKNOWN',
      exitCode: Number.isInteger(state.ExitCode) ? state.ExitCode : null,
      oomKilled: state.OOMKilled === true,
      health: ['healthy', 'unhealthy', 'starting'].includes(state.Health?.Status)
        ? state.Health.Status
        : null,
      failureFacts: failureFacts(
        [state.Error, ...(state.Health?.Log ?? []).map((l) => l.Output)].join('\n'),
      ),
    });
  }
  return {
    phase,
    node: process.version,
    runner: {
      os: env.RUNNER_OS === 'Linux' ? 'Linux' : 'UNKNOWN',
      image: /^[a-z0-9-]{1,32}$/.test(env.ImageOS ?? '') ? env.ImageOS : null,
      imageVersion: /^[0-9.]+$/.test(env.ImageVersion ?? '') ? env.ImageVersion : null,
      runId: /^\d+$/.test(env.GITHUB_RUN_ID ?? '') ? env.GITHUB_RUN_ID : null,
    },
    cliVersion: String(cli.stdout ?? '').match(/\b\d+\.\d+\.\d+\b/)?.[0] ?? null,
    dockerVersion: String(docker.stdout ?? '').match(/^\d+\.\d+\.\d+/)?.[0] ?? null,
    dockerAllowed,
    dockerQuerySucceeded: docker.status === 0 && listed.status === 0,
    exitCode: Number.isInteger(result?.status) ? result.status : null,
    spawnErrorCode: ['ETIMEDOUT', 'ENOENT', 'ENOBUFS'].includes(result?.error?.code)
      ? result.error.code
      : null,
    observations: failureFacts(String(result?.stdout ?? '') + '\n' + String(result?.stderr ?? '')),
    containers,
    cleanup:
      phase === 'cleanup'
        ? docker.status === 0 && listed.status === 0 && ids.length === 0
          ? 'PASS'
          : 'FAIL_OR_UNVERIFIED'
        : 'DEFERRED_TO_EXISTING_WORKFLOW_CLEANUP',
    rootCause: 'NOT_INFERRED_FROM_FLAGS',
  };
}

export function saveDiagnostics(phase, result) {
  if (
    process.platform !== 'linux' ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.RUNNER_OS !== 'Linux'
  )
    throw new Error('Diagnostics require disposable Linux CI');
  if (
    !process.env.RUNNER_TEMP ||
    existsSync('supabase/.temp/project-ref') ||
    process.env.SUPABASE_ACCESS_TOKEN ||
    process.env.SUPABASE_DB_PASSWORD
  )
    throw new Error('External/linked diagnostic environment refused');
  const dir = resolve(process.env.RUNNER_TEMP, 'livio-integrated-artifacts');
  mkdirSync(dir, { recursive: true });
  const evidence = collectDiagnostics(phase, result);
  writeFileSync(
    resolve(dir, `ci-prebuilt-supabase-${phase}.json`),
    JSON.stringify(evidence, null, 2) + '\n',
  );
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] !== '--cleanup-check') throw new Error('Unsupported diagnostic command');
    const stopCode = Number(process.argv[3] ?? 0);
    if (!Number.isInteger(stopCode) || stopCode < 0 || stopCode > 255)
      throw new Error('Invalid cleanup exit code');
    const evidence = saveDiagnostics('cleanup', { status: stopCode });
    console.log(
      JSON.stringify({
        phase: 'cleanup',
        result: evidence.cleanup,
        ownContainers: evidence.containers.length,
        stopExitCode: stopCode,
      }),
    );
    process.exitCode = stopCode || (evidence.cleanup === 'PASS' ? 0 : 1);
  } catch {
    console.error('Disposable cleanup diagnostics refused or failed.');
    process.exitCode = 1;
  }
}
