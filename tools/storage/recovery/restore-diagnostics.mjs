import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function redactRestoreText(value) {
  return String(value)
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[JWT_REDACTED]')
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
    .replace(/(?:postgres(?:ql)?|https?):\/\/[^\s"'<>]+/gi, '[URL_REDACTED]')
    .replace(
      /((?:password|cookie|authorization|access_token|refresh_token|ownerToken|token|signature|secret|api_?key|database_url|connectionString)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
      '$1[REDACTED]',
    )
    .slice(0, 1600);
}

export function restoreErrorDetails(error, seen = new Set()) {
  if (!error || typeof error !== 'object')
    return { name: 'NonError', message: '[DETAILS_WITHHELD]' };
  if (seen.has(error) || seen.size >= 6) return { name: 'CauseChainTruncated' };
  seen.add(error);
  // execFile's raw message/stdout/stderr can contain provider credentials. Never
  // export them; a logical command, exit/signal and cause metadata suffice.
  const external = Object.hasOwn(error, 'stdout') || Object.hasOwn(error, 'stderr');
  return {
    name: redactRestoreText(error.name ?? 'Error'),
    frames: [
      ...String(error.stack ?? '').matchAll(
        /tools[\\/](?:storage[\\/]recovery|qa)[\\/][A-Za-z0-9._-]+\.m?js:\d+:\d+/g,
      ),
    ]
      .slice(0, 3)
      .map((m) => m[0]),
    message: external
      ? '[SUBPROCESS_OUTPUT_WITHHELD]'
      : redactRestoreText(String(error.message ?? '').split('\n')[0]),
    code:
      typeof error.code === 'string' || typeof error.code === 'number'
        ? redactRestoreText(error.code)
        : null,
    exitCode: Number.isInteger(error.exitCode)
      ? error.exitCode
      : external && Number.isInteger(error.status)
        ? error.status
        : null,
    httpStatus:
      typeof error.getStatus === 'function' && Number.isInteger(error.status) ? error.status : null,
    signal: typeof error.signal === 'string' ? redactRestoreText(error.signal) : null,
    subprocessPid: Number.isInteger(error.pid) ? error.pid : null,
    sqlState: external
      ? (String(error.stderr ?? '').match(/(?:SQLSTATE[=: ]+|ERROR:\s+)([0-9A-Z]{5})\b/)?.[1] ??
        null)
      : null,
    stderrSha256:
      external && error.stderr
        ? createHash('sha256').update(String(error.stderr)).digest('hex')
        : null,
    logicalCommand: error.logicalCommand ? redactRestoreText(error.logicalCommand) : null,
    cause: error.cause ? restoreErrorDetails(error.cause, seen) : null,
  };
}

export function restoreCommand(logicalCommand, execute) {
  try {
    return execute();
  } catch (cause) {
    throw Object.assign(new Error('Disposable restore command failed', { cause }), {
      name: 'RestoreCommandError',
      code: 'RESTORE_COMMAND_FAILED',
      logicalCommand,
      exitCode: Number.isInteger(cause.status) ? cause.status : null,
      signal: cause.signal ?? null,
    });
  }
}

export function catalogRecord(name, bytes) {
  const text = bytes.toString(),
    sha256 = createHash('sha256').update(bytes).digest('hex');
  return {
    name,
    sha256,
    bytes: bytes.length,
    // Function bodies and potentially multiline SQL are intentionally hashes,
    // never a raw fallback. Other entries are catalog metadata, not table data.
    rows:
      name === 'functions'
        ? '[FUNCTION_BODIES_WITHHELD]'
        : text.trim().split('\n').filter(Boolean).map(redactRestoreText),
  };
}

export function catalogDifferences(source, target) {
  return [...new Set([...source, ...target].map((r) => r.name))].flatMap((name) => {
    const a = source.find((r) => r.name === name),
      b = target.find((r) => r.name === name);
    return a?.sha256 === b?.sha256 ? [] : [{ name, source: a ?? null, target: b ?? null }];
  });
}

export const recoveryFunctionMetadataQuery = `SELECT coalesce(json_agg(q ORDER BY q.schema,q.name,q.arguments),'[]') FROM (
 SELECT n.nspname AS schema,p.proname AS name,pg_get_function_identity_arguments(p.oid) AS arguments,
 pg_get_userbyid(p.proowner) AS owner,p.proacl::text AS acl,p.prosecdef AS "securityDefiner",
 p.provolatile AS volatility,p.proparallel AS parallel,p.proconfig AS configuration,pg_get_functiondef(p.oid) AS definition
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname IN ('public','auth','storage','supabase_migrations') AND p.prokind='f') q;`;

export function functionCatalogDetails(rows) {
  return rows.map((row) => ({
    schema: row.schema,
    name: row.name,
    arguments: row.arguments,
    owner: row.owner,
    acl: row.acl,
    securityDefiner: row.securityDefiner,
    volatility: row.volatility,
    parallel: row.parallel,
    searchPath: (row.configuration ?? []).filter((value) => value.startsWith('search_path=')),
    configurationSha256: createHash('sha256')
      .update(JSON.stringify(row.configuration ?? []))
      .digest('hex'),
    definitionSha256: createHash('sha256').update(row.definition).digest('hex'),
  }));
}

export function createRestoreDiagnostics({
  runId,
  write,
  identities = () => ({}),
  now = () => new Date().toISOString(),
}) {
  const state = {
    runId,
    pid: process.pid,
    checkpoints: [],
    lastPassed: null,
    lastPassedBeforeFailure: null,
    failedStage: null,
    primaryError: null,
    cleanupErrors: [],
    captureErrors: [],
  };
  let current;
  const stack = (value) =>
    value
      ? Object.fromEntries(
          ['project', 'cluster', 'databaseContainer', 'volume', 'backendPath']
            .filter((k) => typeof value[k] === 'string')
            .map((k) => [k, redactRestoreText(value[k])]),
        )
      : null;
  const identitySnapshot = () => {
    const v = identities();
    return {
      source: stack(v.source),
      target: stack(v.target),
      targetProject: v.targetProject ? redactRestoreText(v.targetProject) : null,
    };
  };
  const persist = (bestEffort = false) => {
    try {
      write(state);
    } catch (error) {
      state.captureErrors.push(restoreErrorDetails(error));
      if (!bestEffort) throw error;
      process.stderr.write(
        JSON.stringify({
          event: 'RESTORE_DIAGNOSTIC_CAPTURE_FAILED',
          stage: current?.stage,
          primary: state.primaryError,
          error: restoreErrorDetails(error),
        }) + '\n',
      );
    }
  };
  return {
    state,
    begin(name, logicalCommand, nextStage, bestEffort = false) {
      current = {
        runId,
        pid: process.pid,
        stage: name,
        logicalCommand: redactRestoreText(logicalCommand),
        nextStage,
        startedAt: now(),
        completedAt: null,
        result: 'IN_PROGRESS',
        identities: identitySnapshot(),
        artifacts: [],
      };
      state.checkpoints.push(current);
      persist(bestEffort);
    },
    command(logicalCommand) {
      if (current) current.logicalCommand = redactRestoreText(logicalCommand);
      persist();
    },
    pass(artifacts = []) {
      assert.ok(current);
      current.result = 'PASS';
      current.completedAt = now();
      current.identities = identitySnapshot();
      current.artifacts = artifacts;
      state.lastPassed = current.stage;
      persist();
    },
    skip(reason) {
      assert.ok(current);
      current.result = 'NOT_EXECUTED';
      current.completedAt = now();
      current.reason = reason;
      persist();
    },
    fail(error) {
      if (!state.primaryError) {
        state.primaryError = restoreErrorDetails(error);
        state.lastPassedBeforeFailure = state.lastPassed;
        state.failedStage = current?.stage ?? 'INITIALIZATION';
      }
      if (current) {
        current.result = 'FAIL';
        current.completedAt = now();
        current.error = restoreErrorDetails(error);
      }
      persist(true);
    },
    flush() {
      persist(true);
    },
    cleanupError(error) {
      state.cleanupErrors.push(restoreErrorDetails(error));
      if (current) {
        current.result = 'FAIL';
        current.error = restoreErrorDetails(error);
        current.completedAt = now();
      }
      persist(true);
    },
  };
}
