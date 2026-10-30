import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
  type Request,
  type Route,
  type Response,
} from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { AFRelationship, PDFDocument } from 'pdf-lib';
import { addMonths, formatDate } from '../../features/shared/format';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001/v1';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const supabaseAuthCookieName = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
const storageBucket = 'legal-documents';
const storageAdminKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const localPassword = 'LocalOnly-ChangeMe-2026!';
const eicarTestFile = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
const organizationA = '10000000-0000-4000-8000-000000000001';
const organizationB = '20000000-0000-4000-8000-000000000001';
const clientA = '11000000-0000-4000-8000-000000000001';
const clientB = '11000000-0000-4000-8000-000000000002';
const clientOrganizationB = '21000000-0000-4000-8000-000000000001';
const matterA = '14000000-0000-4000-8000-000000000001';
const formViewports = [
  { width: 360, height: 800 },
  { width: 1440, height: 900 },
] as const;
const lawyerUserA = 'a1000000-0000-4000-8000-000000000002';
const financeUserA = 'a1000000-0000-4000-8000-000000000004';
const apiOrigin = new URL(apiBase).origin;
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1']);
const externalHostsBlocked = new WeakMap<BrowserContext, Set<string>>();

async function enableLocalNetworkOnly(context: BrowserContext) {
  if (externalHostsBlocked.has(context)) return externalHostsBlocked.get(context)!;
  const externalHosts = new Set<string>();
  externalHostsBlocked.set(context, externalHosts);
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (['http:', 'https:'].includes(url.protocol) && !loopbackHosts.has(url.hostname)) {
      externalHosts.add(url.hostname);
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  return externalHosts;
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };
type BrowserResult = { status: number; body: JsonValue | undefined };
type BrowserOptions = {
  method?: string;
  body?: JsonObject;
  organizationId?: string;
  headers?: Record<string, string>;
};
type PhaseTraffic = {
  requests: number;
  paths: string[];
  latenciesMs: number[];
  httpErrors: Array<{ method: string; path: string; status: number }>;
  failedRequests: Array<{ method: string; path: string; reason: string }>;
  active: number;
  maxConcurrent: number;
  perceivedLoadMs?: number;
};

function createTrafficRecorder(page: Page) {
  const phases = new Map<string, PhaseTraffic>();
  const requestPhases = new Map<Request, { phase: string; path: string; startedAt: number }>();
  let phase = 'setup';
  let maxConcurrent = 0;
  let pending = 0;

  const getPhase = (name: string) => {
    let value = phases.get(name);
    if (!value) {
      value = {
        requests: 0,
        paths: [],
        latenciesMs: [],
        httpErrors: [],
        failedRequests: [],
        active: 0,
        maxConcurrent: 0,
      };
      phases.set(name, value);
    }
    return value;
  };
  const requestPath = (request: Request) => {
    const url = new URL(request.url());
    return url.pathname.replace(
      /\/public\/signatures\/[a-f0-9]{64}/gi,
      '/public/signatures/[redacted]',
    );
  };
  const complete = (request: Request, failed?: string) => {
    const started = requestPhases.get(request);
    if (!started) return;
    requestPhases.delete(request);
    const value = getPhase(started.phase);
    const duration = Math.max(0, performance.now() - started.startedAt);
    value.latenciesMs.push(duration);
    value.active = Math.max(0, value.active - 1);
    pending = Math.max(0, pending - 1);
    if (failed) {
      value.failedRequests.push({
        method: request.method(),
        path: started.path,
        reason: failed.slice(0, 100),
      });
    }
  };

  page.on('request', (request) => {
    if (new URL(request.url()).origin !== apiOrigin) return;
    const value = getPhase(phase);
    const path = requestPath(request);
    requestPhases.set(request, { phase, path, startedAt: performance.now() });
    value.requests += 1;
    value.paths.push(path);
    value.active += 1;
    pending += 1;
    value.maxConcurrent = Math.max(value.maxConcurrent, value.active);
    maxConcurrent = Math.max(maxConcurrent, pending);
  });
  page.on('response', (response) => {
    if (new URL(response.url()).origin !== apiOrigin || response.status() < 400) return;
    const request = response.request();
    const started = requestPhases.get(request);
    if (!started || started.phase === 'security') return;
    getPhase(started.phase).httpErrors.push({
      method: request.method(),
      path: started.path,
      status: response.status(),
    });
  });
  page.on('requestfinished', (request) => complete(request));
  page.on('requestfailed', (request) =>
    complete(request, request.failure()?.errorText ?? 'request failed'),
  );

  return {
    setPhase(value: string) {
      phase = value;
    },
    count(value: string, pathPrefix?: string) {
      const traffic = getPhase(value);
      if (!pathPrefix) return traffic.requests;
      const completed = traffic.paths.filter((path) => path.startsWith(pathPrefix)).length;
      const pendingForPhase = [...requestPhases.values()].filter(
        (request) => request.phase === value && request.path.startsWith(pathPrefix),
      ).length;
      return completed + pendingForPhase;
    },
    countPaths(value: string, pathPrefix: string) {
      const traffic = getPhase(value);
      const completed = traffic.paths.filter((path) => path.startsWith(pathPrefix)).length;
      const pendingForPhase = [...requestPhases.values()].filter(
        (request) => request.phase === value && request.path.startsWith(pathPrefix),
      ).length;
      return completed + pendingForPhase;
    },
    pending() {
      return pending;
    },
    phase(value: string) {
      return getPhase(value);
    },
    maxConcurrent() {
      return maxConcurrent;
    },
    async waitForQuiet() {
      const deadline = Date.now() + 20_000;
      let quietSince: number | undefined;
      while (Date.now() < deadline) {
        if (pending === 0) {
          quietSince ??= Date.now();
          if (Date.now() - quietSince >= 350) return;
        } else quietSince = undefined;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      throw new Error(
        `API requests remained pending: ${[...requestPhases.values()].map(({ path }) => path).join(', ')}`,
      );
    },
    save(metrics: Record<string, unknown>, fileName = 'browser-navigation-metrics.json') {
      const directory = process.env.LIVIO_QA_OUTPUT;
      if (!directory) return;
      const path = join(directory, fileName);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(metrics, null, 2)}\n`, 'utf8');
    },
    toJSON() {
      return {
        phases: Object.fromEntries(
          [...phases.entries()].map(([name, value]) => [name, summarizeTraffic(value)]),
        ),
        maxConcurrentApiRequests: maxConcurrent,
        pendingApiRequests: pending,
      };
    },
  };
}

function writeQaArtifact(fileName: string, value: unknown) {
  const directory = process.env.LIVIO_QA_OUTPUT;
  if (!directory) return;
  const path = join(directory, fileName);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return Number((sorted[Math.ceil(fraction * sorted.length) - 1] ?? 0).toFixed(2));
}

function summarizeTraffic(value: PhaseTraffic) {
  return {
    requests: value.requests,
    maxConcurrent: value.maxConcurrent,
    latencyP50Ms: percentile(value.latenciesMs, 0.5),
    latencyP95Ms: percentile(value.latenciesMs, 0.95),
    perceivedLoadMs: value.perceivedLoadMs ?? null,
    httpErrors: value.httpErrors,
    failedRequests: value.failedRequests,
    pendingRequests: value.active,
  };
}

async function screenshotEvidence(page: Page, name: string) {
  const directory = process.env.LIVIO_QA_OUTPUT;
  if (!directory) return;
  const screenshots = join(directory, 'screenshots');
  mkdirSync(screenshots, { recursive: true });
  const maskedInputs = await page.locator('input').evaluateAll((elements) => {
    const sensitiveSigningPath = /(\/(?:assinar|public\/signatures)\/)[A-Za-z0-9_-]{32,}/gi;
    return elements.flatMap((element, index) => {
      const input = element as HTMLInputElement;
      const originalValue = input.value;
      const redactedValue = originalValue.replace(sensitiveSigningPath, '$1[REDACTED]');
      if (redactedValue === originalValue) return [];
      input.value = redactedValue;
      return [{ index, originalValue }];
    });
  });
  try {
    await page.screenshot({
      path: join(screenshots, `${name}.png`),
      fullPage: false,
      animations: 'disabled',
    });
  } finally {
    for (const { index, originalValue } of maskedInputs) {
      await page
        .locator('input')
        .nth(index)
        .evaluate((element, value) => {
          (element as HTMLInputElement).value = value;
        }, originalValue)
        .catch(() => undefined);
    }
  }
}

async function expectOperationFeedback(page: Page, message: string) {
  const statuses = page.getByRole('status');
  try {
    await expect
      .poll(
        async () =>
          (await statuses.allTextContents()).filter((text) => text.trim() === message).length,
      )
      .toBe(1);
  } catch (error) {
    const trace = currentOperationTrace.get(page);
    if (trace) {
      trace.outcome =
        trace.outcome === 'REQUEST_REJECTED'
          ? 'REQUEST_REJECTED_UI_NOT_UPDATED'
          : 'REQUEST_SUCCEEDED_UI_NOT_UPDATED';
      trace.events.push({
        stage: trace.outcome,
        elapsedMs: Date.now() - trace.startedAt,
      });
      writeOperationTrace(page, trace);
    }
    throw error;
  }
  const statusTexts = await statuses.allTextContents();
  const exactIndex = statusTexts.findIndex((text) => text.trim() === message);
  await expect(statuses.nth(exactIndex)).toHaveText(message);
  const trace = currentOperationTrace.get(page);
  if (trace) {
    trace.events.push({
      stage: 'UI_FEEDBACK_CONFIRMED',
      elapsedMs: Date.now() - trace.startedAt,
      message,
    });
    writeOperationTrace(page, trace);
  }
}

const apiOperationTimeoutMs = 15_000;
type OperationTrace = {
  id: string;
  run: string;
  operation: string;
  testTitle: string;
  viewport: { width: number; height: number } | null;
  startedAt: number;
  outcome: string;
  events: Array<Record<string, JsonValue>>;
};

const currentOperationTrace = new Map<Page, OperationTrace>();
const currentWorkflowStage = new Map<
  Page,
  { testTitle: string; workflow: string; stage: string }
>();
let operationTraceSequence = 0;
let workflowStageSequence = 0;

test.afterEach(async ({ browser }, testInfo) => {
  if (testInfo.status !== testInfo.expectedStatus) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (!page.isClosed())
          await screenshotEvidence(
            page,
            `test-failure-${operationSlug(testInfo.title)}-${page.viewportSize()?.width ?? 'unknown'}`,
          ).catch(() => undefined);
      }
    }
  }
  for (const [page, trace] of currentOperationTrace) {
    if (trace.testTitle !== testInfo.title) continue;
    if (testInfo.status !== testInfo.expectedStatus) {
      const hasUiFeedback = trace.events.some(({ stage }) => stage === 'UI_FEEDBACK_CONFIRMED');
      if (trace.outcome === 'REQUEST_SUCCEEDED' && hasUiFeedback)
        trace.outcome = 'PERSISTENCE_NOT_CONFIRMED';
      trace.events.push({
        stage: 'TEST_FAILED',
        elapsedMs: Date.now() - trace.startedAt,
        testStatus: testInfo.status ?? 'unknown',
      });
      writeOperationTrace(page, trace);
      if (!page.isClosed())
        await screenshotEvidence(page, `test-failure-${trace.id}`).catch(() => undefined);
    }
    currentOperationTrace.delete(page);
  }
  for (const [page, stage] of currentWorkflowStage) {
    if (stage.testTitle !== testInfo.title) continue;
    if (testInfo.status !== testInfo.expectedStatus) {
      writeQaArtifact(
        `workflow-stages/failure-${operationSlug(stage.workflow)}-${page.viewportSize()?.width ?? 'unknown'}.json`,
        {
          ...stage,
          testStatus: testInfo.status ?? 'unknown',
          failedAt: new Date().toISOString(),
        },
      );
      if (!page.isClosed())
        await screenshotEvidence(
          page,
          `test-failure-${operationSlug(stage.workflow)}-${page.viewportSize()?.width ?? 'unknown'}`,
        ).catch(() => undefined);
    }
    currentWorkflowStage.delete(page);
  }
});

function operationSlug(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 64);
}

function writeOperationTrace(page: Page, trace: OperationTrace) {
  const directory = process.env.LIVIO_QA_OUTPUT;
  if (!directory) return;
  writeQaArtifact(`operation-traces/${trace.id}.json`, {
    ...trace,
    elapsedMs: Date.now() - trace.startedAt,
  });
}

function markWorkflowStage(page: Page, workflow: string, stage: string, details: JsonObject = {}) {
  currentWorkflowStage.set(page, { testTitle: test.info().title, workflow, stage });
  const stageSequence = String(++workflowStageSequence).padStart(4, '0');
  writeQaArtifact(
    `workflow-stages/${operationSlug(workflow)}-${page.viewportSize()?.width ?? 'unknown'}-${stageSequence}-${operationSlug(stage)}.json`,
    {
      testTitle: test.info().title,
      workflow,
      stage,
      recordedAt: new Date().toISOString(),
      viewport: page.viewportSize(),
      ...details,
    },
  );
}

async function formWithSubmitButton(page: Page, buttonName: string) {
  const submitButton = page.getByRole('button', { name: buttonName, exact: true });
  await expect(submitButton, `form submit button: ${buttonName}`).toBeVisible();
  const form = submitButton.locator('xpath=ancestor::form');
  await expect(form, `form containing submit button: ${buttonName}`).toHaveCount(1);
  await expect(form).toBeVisible();
  await expect(form.getByRole('button', { name: buttonName, exact: true })).toHaveCount(1);
  return form;
}

async function selectFormOptionByLabel(
  page: Page,
  form: Locator,
  fieldLabel: string,
  optionLabel: string,
  workflow: string,
  stage: string,
  expectedFixtureValue?: string,
) {
  const escapedLabel = fieldLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const select = form.getByRole('combobox', {
    name: new RegExp(`^${escapedLabel}(?:\\s|$)`),
  });
  await expect(select, `${workflow}: one accessible ${fieldLabel} control`).toHaveCount(1);
  await expect(select, `${workflow}: ${fieldLabel} control`).toBeVisible();
  const expectedOption = select.getByRole('option', { name: optionLabel, exact: true });
  try {
    await expect(
      expectedOption,
      `${workflow}: wait for the ${fieldLabel} option ${optionLabel} to load`,
    ).toHaveCount(1);
  } catch (error) {
    const availableOptions = await select.locator('option').evaluateAll((elements) =>
      elements.map((element) => {
        const option = element as HTMLOptionElement;
        return { label: option.label.trim(), value: option.value };
      }),
    );
    markWorkflowStage(page, workflow, `${stage}-option-load-failed`, {
      fieldLabel,
      optionLabel,
      availableOptions,
      expectedFixtureValue: expectedFixtureValue ?? null,
    });
    throw error;
  }
  const option = await select.evaluate((element, targetLabel) => {
    const matchingOptions = Array.from((element as HTMLSelectElement).options).filter(
      (candidate) => candidate.label.trim() === targetLabel,
    );
    const match = matchingOptions[0];
    return {
      optionCount: (element as HTMLSelectElement).options.length,
      matchCount: matchingOptions.length,
      value: match?.value ?? null,
    };
  }, optionLabel);
  const expectedFixtureValueMatches = expectedFixtureValue
    ? option.value === expectedFixtureValue
    : null;
  markWorkflowStage(page, workflow, `${stage}-option-inspected`, {
    fieldLabel,
    optionLabel,
    optionCount: option.optionCount,
    targetOptionCount: option.matchCount,
    optionValue: option.value,
    expectedFixtureValueMatches,
  });
  expect(option.matchCount, `${workflow}: one ${fieldLabel} option named ${optionLabel}`).toBe(1);
  expect(option.value, `${workflow}: ${fieldLabel} option has a value`).toBeTruthy();
  if (expectedFixtureValue)
    expect(option.value, `${workflow}: ${fieldLabel} UUID matches the fixture`).toBe(
      expectedFixtureValue,
    );

  const value = option.value!;
  const selectedValues = await select.selectOption(
    { label: optionLabel },
    {
      timeout: apiOperationTimeoutMs,
    },
  );
  expect(selectedValues).toEqual([value]);
  if (expectedFixtureValue)
    expect(value, `${workflow}: selected ${fieldLabel} UUID matches the fixture`).toBe(
      expectedFixtureValue,
    );
  await expect(select).toHaveValue(value, { timeout: apiOperationTimeoutMs });
  await expect(select.locator('option:checked')).toHaveText(optionLabel);
  markWorkflowStage(page, workflow, `${stage}-selected`, {
    fieldLabel,
    optionLabel,
    selectedValue: value,
    placeholderCleared: value !== '',
    selected: true,
    expectedFixtureValueMatches,
  });
  return value;
}

type UiOperation = {
  operation: string;
  pathname: string;
  method?: string;
  form?: Locator;
  button?: Locator;
  action?: () => Promise<unknown>;
  bodyField?: { name: string; value: string };
  additionalBodyFields?: Array<{ name: string; value: string }>;
};

type DiagnosticWindow = Window & {
  __livioQaClickEvents?: Record<string, boolean>;
  __livioQaSubmitEvents?: Record<string, boolean>;
};

function requestMatchesBodyFields(
  request: Request,
  fields: Array<{ name: string; value: string }>,
) {
  if (!fields.length) return true;
  try {
    const body = request.postDataJSON() as Record<string, unknown> | null;
    if (body && fields.every((field) => body[field.name] === field.value)) return true;
  } catch {
    // Multipart bodies are correlated by named synthetic form fields below.
  }
  const body = request.postDataBuffer()?.toString('latin1');
  if (!body) return false;
  return fields.every((field) => {
    const fieldMarker = `name="${field.name}"`;
    const markerIndex = body.indexOf(fieldMarker);
    if (markerIndex < 0) return false;
    const crlfSeparator = body.indexOf('\r\n\r\n', markerIndex);
    const lfSeparator = body.indexOf('\n\n', markerIndex);
    const separatorIndex = crlfSeparator >= 0 ? crlfSeparator : lfSeparator;
    const separatorLength = crlfSeparator >= 0 ? 4 : 2;
    if (separatorIndex < 0) return false;
    const submittedValue = body.slice(separatorIndex + separatorLength).split(/\r?\n/, 1)[0];
    return submittedValue === field.value;
  });
}

function requestBodyFieldMatches(request: Request, fields: Array<{ name: string; value: string }>) {
  return fields.map(({ name, value }) => ({
    name,
    matchesExpectedValue: requestMatchesBodyFields(request, [{ name, value }]),
  }));
}

async function clickUiOperation(page: Page, operation: UiOperation) {
  const method = operation.method ?? 'POST';
  const traceSequence = String(++operationTraceSequence).padStart(4, '0');
  const run = process.env.LIVIO_PLAYWRIGHT_RUN ?? 'integrated';
  const clickObserverKey = `${run}-${traceSequence}`;
  const bodyFields = [
    ...(operation.bodyField ? [operation.bodyField] : []),
    ...(operation.additionalBodyFields ?? []),
  ];
  const trace: OperationTrace = {
    id: `${operationSlug(run)}-${page.viewportSize()?.width ?? 'unknown'}-${traceSequence}-${operationSlug(operation.operation)}`,
    run,
    operation: operation.operation,
    testTitle: test.info().title,
    viewport: page.viewportSize(),
    startedAt: Date.now(),
    outcome: 'ACTION_NOT_TRIGGERED',
    events: [],
  };
  currentOperationTrace.set(page, trace);
  let actionTriggered = false;
  let requestObserved = false;
  let requestBodyMismatch = false;
  let submitObserved = false;
  let responseObserved = false;
  let responseStatus: number | undefined;
  const invalidFields: string[] = [];
  const matchesEndpoint = (request: Request) =>
    new URL(request.url()).pathname === operation.pathname && request.method() === method;
  const requestListener = (request: Request) => {
    if (!matchesEndpoint(request)) return;
    requestObserved = true;
    const bodyFieldMatches = requestBodyFieldMatches(request, bodyFields);
    requestBodyMismatch = bodyFieldMatches.some(
      ({ matchesExpectedValue }) => !matchesExpectedValue,
    );
    trace.events.push({
      stage: 'REQUEST_SENT',
      elapsedMs: Date.now() - trace.startedAt,
      method: request.method(),
      pathname: new URL(request.url()).pathname,
      bodyFieldMatches,
    });
    writeOperationTrace(page, trace);
  };
  const failedListener = (request: Request) => {
    if (!matchesEndpoint(request)) return;
    trace.events.push({
      stage: 'REQUEST_FAILED',
      elapsedMs: Date.now() - trace.startedAt,
      reason: request.failure()?.errorText?.slice(0, 120) ?? 'unknown',
    });
    writeOperationTrace(page, trace);
  };
  const responseListener = (response: Response) => {
    const request = response.request();
    if (!matchesEndpoint(request)) return;
    responseObserved = true;
    responseStatus = response.status();
    trace.events.push({
      stage: 'HTTP_RESPONSE',
      elapsedMs: Date.now() - trace.startedAt,
      method: request.method(),
      pathname: new URL(request.url()).pathname,
      status: response.status(),
    });
    writeOperationTrace(page, trace);
  };
  page.on('request', requestListener);
  page.on('requestfailed', failedListener);
  page.on('response', responseListener);

  let requestPromise: Promise<{ value: Request } | { error: unknown }> | undefined;
  let responsePromise:
    | Promise<{ value: Awaited<ReturnType<Page['waitForResponse']>> } | { error: unknown }>
    | undefined;
  try {
    if (!operation.button && !operation.action)
      throw new Error('Operation requires an accessible button or UI action');
    if (operation.button) {
      await expect(operation.button, `${operation.operation}: action control`).toBeVisible();
      await expect(operation.button, `${operation.operation}: action control`).toBeEnabled();
      await operation.button.evaluate((element, observerKey) => {
        const diagnosticWindow = window as DiagnosticWindow;
        diagnosticWindow.__livioQaClickEvents ??= {};
        diagnosticWindow.__livioQaClickEvents[observerKey] = false;
        element.addEventListener(
          'click',
          () => {
            diagnosticWindow.__livioQaClickEvents![observerKey] = true;
          },
          { capture: true, once: true },
        );
      }, clickObserverKey);
    }
    if (operation.form) {
      await expect(operation.form, `${operation.operation}: form`).toBeVisible();
      const formState = await operation.form.evaluate((element) => {
        const form = element as HTMLFormElement;
        return {
          valid: form.checkValidity(),
          invalidFields: Array.from(
            form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
              'input, select, textarea',
            ),
          )
            .filter((field) => !field.validity.valid)
            .map((field) => ({
              name: field.name || field.id || field.tagName,
              validationMessage: field.validationMessage,
            })),
        };
      });
      invalidFields.push(...formState.invalidFields.map(({ name }) => name));
      trace.events.push({
        stage: 'FORM_CHECKED',
        elapsedMs: Date.now() - trace.startedAt,
        valid: formState.valid,
        invalidFields: formState.invalidFields,
      });
      await operation.form.evaluate((element, observerKey) => {
        const form = element as HTMLFormElement;
        const diagnosticWindow = window as DiagnosticWindow;
        diagnosticWindow.__livioQaSubmitEvents ??= {};
        diagnosticWindow.__livioQaSubmitEvents[observerKey] = false;
        form.addEventListener(
          'submit',
          () => {
            diagnosticWindow.__livioQaSubmitEvents![observerKey] = true;
          },
          { capture: true, once: true },
        );
      }, clickObserverKey);
      if (invalidFields.length) {
        await operation.button!.click();
        actionTriggered =
          (await page.evaluate(
            (observerKey) =>
              (window as DiagnosticWindow).__livioQaClickEvents?.[observerKey] === true,
            clickObserverKey,
          )) ?? false;
        trace.events.push({
          stage: 'BUTTON_CLICK_EVENT',
          elapsedMs: Date.now() - trace.startedAt,
          observed: actionTriggered,
        });
        trace.outcome = 'ACTION_NOT_TRIGGERED';
        trace.events.push({
          stage: trace.outcome,
          elapsedMs: Date.now() - trace.startedAt,
          invalidFieldCount: invalidFields.length,
        });
        writeOperationTrace(page, trace);
        throw new Error(
          `${trace.outcome}: browser validation blocked submit; invalid fields: ${invalidFields.join(', ')}`,
        );
      }
    }
    requestPromise = page.waitForRequest(matchesEndpoint, { timeout: apiOperationTimeoutMs }).then(
      (value) => ({ value }),
      (error: unknown) => ({ error }),
    );
    responsePromise = page
      .waitForResponse((response) => matchesEndpoint(response.request()), {
        timeout: apiOperationTimeoutMs,
      })
      .then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      );
    if (operation.button) {
      await operation.button.click();
      actionTriggered =
        (await page.evaluate(
          (observerKey) =>
            (window as DiagnosticWindow).__livioQaClickEvents?.[observerKey] === true,
          clickObserverKey,
        )) ?? false;
      trace.events.push({
        stage: 'BUTTON_CLICK_EVENT',
        elapsedMs: Date.now() - trace.startedAt,
        observed: actionTriggered,
      });
    } else {
      await operation.action!();
      actionTriggered = true;
    }
    trace.events.push({
      stage: operation.button ? 'BUTTON_CLICKED' : 'UI_ACTION_TRIGGERED',
      elapsedMs: Date.now() - trace.startedAt,
    });
    submitObserved = operation.form
      ? ((await page.evaluate(
          (observerKey) =>
            (window as DiagnosticWindow).__livioQaSubmitEvents?.[observerKey] === true,
          clickObserverKey,
        )) ?? false)
      : true;
    trace.events.push({
      stage: operation.form ? 'FORM_SUBMIT_EVENT' : 'UI_ACTION_DISPATCHED',
      elapsedMs: Date.now() - trace.startedAt,
      observed: submitObserved,
    });
    if (invalidFields.length || !submitObserved || (operation.button && !actionTriggered)) {
      trace.outcome = 'ACTION_NOT_TRIGGERED';
      trace.events.push({
        stage: trace.outcome,
        elapsedMs: Date.now() - trace.startedAt,
        invalidFieldCount: invalidFields.length,
        clickObserved: operation.button ? actionTriggered : null,
        submitObserved,
      });
      throw new Error(
        `${trace.outcome}: ${operation.operation}; invalid fields: ${invalidFields.join(', ') || 'none'}; click observed: ${operation.button ? actionTriggered : 'not applicable'}; submit observed: ${submitObserved}`,
      );
    }
    const [requestResult, responseResult] = await Promise.all([requestPromise, responsePromise]);
    if ('error' in requestResult) throw requestResult.error;
    if ('error' in responseResult) throw responseResult.error;
    const { value: request } = requestResult;
    const { value: response } = responseResult;
    requestObserved = true;
    const bodyFieldMatches = requestBodyFieldMatches(request, bodyFields);
    requestBodyMismatch = bodyFieldMatches.some(
      ({ matchesExpectedValue }) => !matchesExpectedValue,
    );
    if (requestBodyMismatch) {
      trace.outcome = 'REQUEST_BODY_MISMATCH';
      trace.events.push({
        stage: trace.outcome,
        elapsedMs: Date.now() - trace.startedAt,
        method: request.method(),
        pathname: new URL(request.url()).pathname,
        status: response.status(),
        bodyFieldMatches,
      });
      writeOperationTrace(page, trace);
      throw new Error('the submitted request does not contain the selected form values');
    }
    trace.events.push({
      stage: 'REQUEST_BODY_CONFIRMED',
      elapsedMs: Date.now() - trace.startedAt,
      bodyFieldMatches,
    });
    trace.outcome = response.status() >= 400 ? 'REQUEST_REJECTED' : 'REQUEST_SUCCEEDED';
    trace.events.push({
      stage: trace.outcome,
      elapsedMs: Date.now() - trace.startedAt,
      method: request.method(),
      pathname: new URL(request.url()).pathname,
      status: response.status(),
    });
    writeOperationTrace(page, trace);
    return response;
  } catch (error) {
    if (!trace.events.some(({ stage }) => stage === 'ACTION_NOT_TRIGGERED')) {
      trace.outcome = requestBodyMismatch
        ? 'REQUEST_BODY_MISMATCH'
        : !actionTriggered
          ? 'ACTION_NOT_TRIGGERED'
          : responseObserved
            ? responseStatus !== undefined && responseStatus >= 400
              ? 'REQUEST_REJECTED'
              : 'REQUEST_SUCCEEDED_UI_NOT_UPDATED'
            : requestObserved
              ? 'REQUEST_SENT_NO_RESPONSE'
              : submitObserved
                ? 'REQUEST_NOT_SENT'
                : 'ACTION_NOT_TRIGGERED';
      trace.events.push({
        stage: trace.outcome,
        elapsedMs: Date.now() - trace.startedAt,
        invalidFieldCount: invalidFields.length,
      });
    }
    writeOperationTrace(page, trace);
    const directory = process.env.LIVIO_QA_OUTPUT;
    if (directory) {
      await screenshotEvidence(page, `operation-failure-${trace.id}`).catch(() => undefined);
    }
    throw new Error(`${trace.outcome}: ${operation.operation} (${method} ${operation.pathname})`, {
      cause: error,
    });
  } finally {
    page.off('request', requestListener);
    page.off('requestfailed', failedListener);
    page.off('response', responseListener);
    if (operation.button)
      await page
        .evaluate((observerKey) => {
          const diagnosticWindow = window as DiagnosticWindow;
          delete diagnosticWindow.__livioQaClickEvents?.[observerKey];
          delete diagnosticWindow.__livioQaSubmitEvents?.[observerKey];
        }, clickObserverKey)
        .catch(() => undefined);
  }
}

function confirmPersistence(page: Page, operation: string) {
  const trace = currentOperationTrace.get(page);
  if (!trace || trace.operation !== operation) return;
  trace.outcome = 'PERSISTENCE_CONFIRMED';
  trace.events.push({ stage: 'PERSISTENCE_CONFIRMED', elapsedMs: Date.now() - trace.startedAt });
  writeOperationTrace(page, trace);
}

function recordOperationStage(page: Page, operation: string, stage: string) {
  const trace = currentOperationTrace.get(page);
  if (!trace || trace.operation !== operation) return;
  trace.events.push({ stage, elapsedMs: Date.now() - trace.startedAt });
  writeOperationTrace(page, trace);
}

async function login(page: Page, email: string, onSubmit?: () => void) {
  await enableLocalNetworkOnly(page.context());
  await page.goto('/');
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('textbox', { name: 'Senha' }).fill(localPassword);
  await page.getByRole('button', { name: 'Entrar no sistema' }).click();
  onSubmit?.();
  await page.locator('#primary-navigation').waitFor({ state: 'visible' });
}

async function navigateTo(page: Page, name: string | RegExp) {
  const menu = page.getByRole('main').getByRole('button', { name: /^(Abrir|Fechar) navegação$/ });
  const isMobile = (page.viewportSize()?.width ?? 1440) <= 900;
  if (isMobile) {
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('aria-controls', 'primary-navigation');
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    await menu.click();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
  } else {
    await expect(menu).toBeHidden();
  }

  const item = page.locator('#primary-navigation').getByRole('button', { name });
  await expect(item).toBeVisible();
  await expect(item).toBeEnabled();
  await item.click();

  if (isMobile) await expect(menu).toHaveAttribute('aria-expanded', 'false');
}

test('seletor de cliente: carregamento sob demanda, erro, nova tentativa e lista vazia', async ({
  browser,
}) => {
  for (const viewport of formViewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    let releaseClientResponse: (() => void) | undefined;
    try {
      await login(page, 'qa-selector.aurora@example.test');
      await navigateTo(page, 'Processos');
      const clientsPath = `${new URL(apiBase).pathname.replace(/\/$/, '')}/clients`;
      const isClientListRequest = (route: Route) =>
        route.request().method() === 'GET' &&
        new URL(route.request().url()).pathname === clientsPath;

      let clientRequestStarted = false;
      const clientResponseGate = new Promise<void>((resolve) => {
        releaseClientResponse = resolve;
      });
      await page.route('**/v1/clients**', async (route) => {
        if (!isClientListRequest(route)) return route.continue();
        const response = await route.fetch();
        clientRequestStarted = true;
        await clientResponseGate;
        await route.fulfill({ response });
      });
      await page.getByRole('button', { name: 'Novo processo', exact: true }).click();
      const loadingForm = await formWithSubmitButton(page, 'Cadastrar processo');
      const loadingClientSelect = loadingForm.getByRole('combobox', {
        name: 'Cliente',
        exact: true,
      });
      await expect.poll(() => clientRequestStarted, { timeout: apiOperationTimeoutMs }).toBe(true);
      await expect(loadingForm.getByRole('status')).toContainText('Carregando clientes');
      await expect(loadingClientSelect).toBeDisabled();
      markWorkflowStage(page, 'client-select-state-probe', 'loading', {
        fieldLabel: 'Cliente',
        selectDisabled: true,
      });
      releaseClientResponse?.();
      await expect(loadingClientSelect).toBeEnabled({ timeout: apiOperationTimeoutMs });
      await expect(
        loadingClientSelect.getByRole('option', { name: 'Cliente Ficticio Alfa', exact: true }),
      ).toHaveAttribute('value', clientA);
      await page.unroute('**/v1/clients**');

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
      await navigateTo(page, 'Processos');
      let listRequestCount = 0;
      await page.route('**/v1/clients**', async (route) => {
        if (!isClientListRequest(route)) return route.continue();
        listRequestCount += 1;
        if (listRequestCount === 1) {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Falha temporária sintética.' }),
          });
          return;
        }
        await route.continue();
      });
      await page.getByRole('button', { name: 'Novo processo', exact: true }).click();
      const errorForm = await formWithSubmitButton(page, 'Cadastrar processo');
      await expect(errorForm.getByRole('alert')).toContainText(
        'Não foi possível carregar os clientes.',
      );
      const retryButton = errorForm.getByRole('button', {
        name: 'Tentar carregar clientes novamente',
        exact: true,
      });
      await expect(retryButton).toBeVisible();
      await retryButton.click();
      const retryClientSelect = errorForm.getByRole('combobox', { name: 'Cliente', exact: true });
      await expect(
        retryClientSelect.getByRole('option', { name: 'Cliente Ficticio Alfa', exact: true }),
      ).toHaveAttribute('value', clientA);
      expect(listRequestCount).toBe(2);
      markWorkflowStage(page, 'client-select-state-probe', 'error-retried', {
        requestCount: listRequestCount,
        optionLabel: 'Cliente Ficticio Alfa',
        optionValue: clientA,
      });
      await page.unroute('**/v1/clients**');

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
      await navigateTo(page, 'Processos');
      await page.route('**/v1/clients**', async (route) => {
        if (!isClientListRequest(route)) return route.continue();
        const response = await route.fetch();
        const body = (await response.json()) as { items?: unknown[]; total?: number };
        await route.fulfill({ response, json: { ...body, items: [], total: 0 } });
      });
      await page.getByRole('button', { name: 'Novo processo', exact: true }).click();
      const emptyForm = await formWithSubmitButton(page, 'Cadastrar processo');
      const emptyClientSelect = emptyForm.getByRole('combobox', { name: 'Cliente', exact: true });
      const emptyClientMessage = emptyForm
        .getByRole('status')
        .filter({ hasText: 'Nenhum cliente acessível está cadastrado neste escritório.' });
      await expect(emptyClientMessage).toHaveCount(1);
      await expect(emptyClientMessage).toBeVisible();
      await expect(emptyClientSelect.locator('option')).toHaveCount(1);
      await expect(emptyClientSelect.locator('option').first()).toHaveText(
        'Nenhum cliente disponível',
      );
      expect(
        await emptyClientSelect.evaluate(
          (element) => (element as HTMLSelectElement).validity.valueMissing,
        ),
      ).toBe(true);
      markWorkflowStage(page, 'client-select-state-probe', 'empty', {
        fieldLabel: 'Cliente',
        optionCount: 0,
        placeholder: 'Nenhum cliente disponível',
        requiredSelectionMissing: true,
      });
    } finally {
      releaseClientResponse?.();
      await context.close();
    }
  }
});

async function browserAccessToken(page: Page): Promise<string | undefined> {
  const cookieValue = await page.evaluate((cookieName) => {
    const cookies = document.cookie
      .split(';')
      .map((cookie) => cookie.trim())
      .map((cookie) => {
        const separator = cookie.indexOf('=');
        return separator < 0
          ? { name: cookie, value: '' }
          : { name: cookie.slice(0, separator), value: cookie.slice(separator + 1) };
      });
    const unchunked = cookies.find(({ name }) => name === cookieName);
    if (unchunked) return decodeURIComponent(unchunked.value);

    return cookies
      .filter(
        ({ name }) =>
          name.startsWith(`${cookieName}.`) && /^\d+$/.test(name.slice(cookieName.length + 1)),
      )
      .sort(
        ({ name: left }, { name: right }) =>
          Number(left.slice(cookieName.length + 1)) - Number(right.slice(cookieName.length + 1)),
      )
      .map(({ value }) => decodeURIComponent(value))
      .join('');
  }, supabaseAuthCookieName);

  if (!cookieValue) return undefined;

  try {
    const serializedSession = cookieValue.startsWith('base64-')
      ? Buffer.from(cookieValue.slice('base64-'.length), 'base64url').toString('utf8')
      : cookieValue;
    return (JSON.parse(serializedSession) as { access_token?: string }).access_token;
  } catch {
    return undefined;
  }
}

async function browserApi(
  page: Page,
  path: string,
  {
    method = 'GET',
    body,
    organizationId = organizationA,
    headers: extraHeaders,
  }: BrowserOptions = {},
): Promise<BrowserResult> {
  const accessToken = await browserAccessToken(page);
  if (!accessToken) return { status: 0, body: { error: 'Supabase browser session unavailable' } };

  const response = await page.evaluate(
    async ({
      apiBase,
      apiPath,
      httpMethod,
      payloadJson,
      selectedOrganization,
      accessToken,
      headers: customHeaders,
    }) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${accessToken}`,
        'X-Organization-Id': selectedOrganization,
        ...customHeaders,
      };
      const init: RequestInit = { method: httpMethod, headers };
      if (payloadJson !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = payloadJson;
      }
      const response = await fetch(`${apiBase}${apiPath}`, init);
      return { status: response.status, bodyText: await response.text() };
    },
    {
      apiBase,
      apiPath: path,
      httpMethod: method,
      payloadJson: body === undefined ? undefined : JSON.stringify(body),
      selectedOrganization: organizationId,
      accessToken,
      headers: extraHeaders ?? {},
    },
  );
  let parsed: JsonValue | undefined;
  try {
    parsed = response.bodyText ? (JSON.parse(response.bodyText) as JsonValue) : undefined;
  } catch {
    parsed = { nonJsonResponse: true };
  }
  return { status: response.status, body: parsed };
}

async function browserUpload(
  page: Page,
  metadata: Record<string, string>,
  fileName: string,
  mimeType: string,
  bytes: number[],
  organizationId = organizationA,
): Promise<BrowserResult> {
  const accessToken = await browserAccessToken(page);
  if (!accessToken) return { status: 0, body: { error: 'Supabase browser session unavailable' } };

  return page.evaluate(
    async ({ apiBase, fields, name, type, content, organizationId, accessToken }) => {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.append(key, value);
      form.append('file', new File([Uint8Array.from(content)], name, { type }));
      const response = await fetch(`${apiBase}/documents`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'X-Organization-Id': organizationId,
        },
        body: form,
      });
      const text = await response.text();
      let parsed: JsonValue | undefined;
      try {
        parsed = text ? (JSON.parse(text) as JsonValue) : undefined;
      } catch {
        parsed = { nonJsonResponse: true };
      }
      return { status: response.status, body: parsed };
    },
    {
      apiBase,
      fields: metadata,
      name: fileName,
      type: mimeType,
      content: bytes,
      organizationId,
      accessToken,
    },
  );
}

async function pdfBytes(embeddedFile?: string): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.addPage([300, 144]);
  if (embeddedFile !== undefined)
    await document.attach(Buffer.from(embeddedFile, 'ascii'), 'eicar.com', {
      mimeType: 'application/octet-stream',
      description: 'ClamAV EICAR scanner test',
      afRelationship: AFRelationship.Data,
    });

  // Keep the embedded test file uncompressed so clamd scans its exact bytes.
  const context = document.context;
  const originalFlateStream = context.flateStream;
  context.flateStream = function (contents, dictionary) {
    return this.stream(contents, dictionary);
  };
  try {
    return Buffer.from(await document.save({ useObjectStreams: false }));
  } finally {
    context.flateStream = originalFlateStream;
  }
}

function ownedClamavContainer(): string {
  const runId = process.env.GITHUB_RUN_ID;
  const runnerTemp = process.env.RUNNER_TEMP;
  const expectedName = `livio-clamav-${runId}`;
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.RUNNER_OS !== 'Linux' ||
    !/^\d+$/.test(runId ?? '') ||
    !runnerTemp ||
    process.env.CLAMAV_HOST !== '127.0.0.1' ||
    process.env.CLAMAV_PORT !== '13310'
  ) {
    throw new Error("ClamAV integration failures require this run's loopback-only Linux service.");
  }
  const markerPath = join(runnerTemp, `${expectedName}.json`);
  if (!existsSync(markerPath)) throw new Error('ClamAV run ownership marker is missing.');
  const metadata = JSON.parse(readFileSync(markerPath, 'utf8')) as {
    name?: string;
    containerId?: string;
  };
  if (metadata.name !== expectedName || !metadata.containerId)
    throw new Error('ClamAV service does not match this workflow run.');
  return expectedName;
}

function controlClamavContainer(action: 'pause' | 'unpause' | 'stop' | 'start', name: string) {
  execFileSync('docker', [action, name], { stdio: 'ignore' });
}

function dateInput(offsetDays = 0) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function reportDateRange() {
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 2);
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 7);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    fromDate: from.toISOString().slice(0, 10),
    toDate: to.toISOString().slice(0, 10),
  };
}

function reportRange(range = reportDateRange()) {
  return `from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}&groupBy=day`;
}

function cashFlowPaidExpenseUnits(rows: Array<{ paid_expenses: string }>) {
  return rows.reduce((total, row) => total + amountUnits(row.paid_expenses), 0n);
}

function formatCurrencyUnits(value: bigint) {
  if (value % 100n !== 0n) throw new Error(`Currency has sub-cent precision: ${value}`);
  const cents = value / 100n;
  const sign = cents < 0n ? '-' : '';
  const absoluteCents = cents < 0n ? -cents : cents;
  const whole = (absoluteCents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = (absoluteCents % 100n).toString().padStart(2, '0');
  return `R$ ${sign}${whole},${fraction}`;
}

function assertStatus(result: BrowserResult, expected: number, label: string) {
  expect(result.status, `${label} returned HTTP ${result.status}`).toBe(expected);
}

function assertAuthorizationDenial(
  result: BrowserResult,
  expected: { status: 401 | 404; code: string; message: string; label: string },
) {
  assertStatus(result, expected.status, expected.label);
  const payload = bodyAs<{ statusCode?: number; code?: string; message?: string | string[] }>(
    result,
  );
  expect(payload.statusCode, `${expected.label} response status`).toBe(expected.status);
  expect(payload.code, `${expected.label} response type`).toBe(expected.code);
  const messages = Array.isArray(payload.message) ? payload.message : [payload.message ?? ''];
  expect(messages.join(' '), `${expected.label} authorization reason`).toContain(expected.message);
}

function bodyAs<T>(result: BrowserResult): T {
  return result.body as T;
}

function amountUnits(value: string): bigint {
  const normalized = value.trim().replace(',', '.');
  const [whole, fraction = ''] = normalized.split('.');
  if (!/^\d+(\.\d{1,4})?$/.test(normalized)) throw new Error(`Invalid decimal: ${value}`);
  return BigInt(whole!) * 10_000n + BigInt(fraction.padEnd(4, '0'));
}

test('autenticação real, navegação, carregamento sob demanda e compartilhamento de membership', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const metricsByViewport: Record<string, unknown> = {};
  let mobileMembershipBurst: unknown;
  for (const viewport of formViewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const traffic = createTrafficRecorder(page);
    let dashboardStartedAt = performance.now();
    let metricsSaved = false;
    const externalHosts = await enableLocalNetworkOnly(page.context());
    traffic.setPhase('setup');
    try {
      await login(page, 'qa-navigation.aurora@example.test', () => {
        traffic.setPhase('dashboard');
        dashboardStartedAt = performance.now();
      });
      const menuToggle = page
        .getByRole('main')
        .getByRole('button', { name: /^(Abrir|Fechar) navegação$/ });
      if (viewport.width <= 900) {
        await expect(menuToggle).toBeVisible();
        await expect(menuToggle).toHaveAttribute('aria-controls', 'primary-navigation');
        await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
        await menuToggle.click();
        await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
        await expect(page.locator('.sidebar-backdrop')).toBeVisible();
        await screenshotEvidence(page, 'navigation-menu-open-360');
        const closePoint = {
          x: viewport.width - 12,
          y: Math.floor(viewport.height / 2),
        };
        const backdropOwnsClosePoint = await page.evaluate(
          ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest('.sidebar-backdrop')),
          closePoint,
        );
        expect(backdropOwnsClosePoint).toBe(true);
        await page.locator('.sidebar-backdrop').click({ position: closePoint });
        await expect(page.locator('.sidebar-backdrop')).toBeHidden();
        await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
        await menuToggle.click();
        await expect(menuToggle).toHaveAttribute('aria-expanded', 'true');
        const dashboardItem = page
          .locator('#primary-navigation')
          .getByRole('button', { name: 'Visão geral', exact: true });
        await expect(dashboardItem).toBeVisible();
        await expect(dashboardItem).toBeEnabled();
        await dashboardItem.click();
        await expect(menuToggle).toHaveAttribute('aria-expanded', 'false');
      } else await expect(menuToggle).toBeHidden();
      await expect(page.getByRole('heading', { name: /Vis.o geral/ })).toBeVisible();
      await traffic.waitForQuiet();
      await screenshotEvidence(page, `navigation-dashboard-${viewport.width}`);
      traffic.phase('dashboard').perceivedLoadMs = Number(
        (performance.now() - dashboardStartedAt).toFixed(2),
      );

      const navigations = [
        { phase: 'clients', nav: 'Clientes', heading: 'Clientes' },
        { phase: 'matters', nav: 'Processos', heading: 'Processos' },
        { phase: 'finance', nav: /Receb/, heading: 'Entradas, parcelas e pagamentos' },
      ];
      for (const destination of navigations) {
        traffic.setPhase(destination.phase);
        const began = performance.now();
        await navigateTo(page, destination.nav);
        await expect(
          page.getByRole('heading', { name: destination.heading, exact: true }),
        ).toBeVisible();
        await traffic.waitForQuiet();
        await screenshotEvidence(page, `navigation-${destination.phase}-${viewport.width}`);
        traffic.phase(destination.phase).perceivedLoadMs = Number(
          (performance.now() - began).toFixed(2),
        );
      }

      expect(traffic.phase('finance').httpErrors).toEqual([]);
      expect(traffic.countPaths('finance', '/v1/finance/expenses')).toBe(0);
      traffic.setPhase('expenses');
      const expenseBegan = performance.now();
      await page.getByRole('heading', { name: 'Despesas', exact: true }).scrollIntoViewIfNeeded();
      await expect
        .poll(() => traffic.countPaths('expenses', '/v1/finance/expenses'))
        .toBeGreaterThan(0);
      await traffic.waitForQuiet();
      await screenshotEvidence(page, `navigation-expenses-${viewport.width}`);
      traffic.phase('expenses').perceivedLoadMs = Number(
        (performance.now() - expenseBegan).toFixed(2),
      );

      for (const destination of [
        { phase: 'documents', nav: 'Documentos', heading: 'Documentos' },
        { phase: 'tasks', nav: 'Tarefas', heading: 'Tarefas' },
      ]) {
        traffic.setPhase(destination.phase);
        const began = performance.now();
        await navigateTo(page, destination.nav);
        await expect(
          page.getByRole('heading', { name: destination.heading, exact: true }),
        ).toBeVisible();
        await traffic.waitForQuiet();
        await screenshotEvidence(page, `navigation-${destination.phase}-${viewport.width}`);
        traffic.phase(destination.phase).perceivedLoadMs = Number(
          (performance.now() - began).toFixed(2),
        );
      }

      traffic.setPhase('dashboardReturn');
      const dashboardReturnStartedAt = performance.now();
      await navigateTo(page, /Vis.o geral/);
      await expect(page.getByRole('heading', { name: /Vis.o geral/ })).toBeVisible();
      await traffic.waitForQuiet();
      await screenshotEvidence(page, `navigation-dashboard-return-${viewport.width}`);
      traffic.phase('dashboardReturn').perceivedLoadMs = Number(
        (performance.now() - dashboardReturnStartedAt).toFixed(2),
      );
      expect(traffic.phase('dashboardReturn').httpErrors).toEqual([]);

      traffic.setPhase('membershipBurst');
      const membershipStartedAt = Date.now();
      const burst = await Promise.all([
        browserApi(page, '/dashboard/summary'),
        browserApi(page, '/clients?page=1&pageSize=5'),
        browserApi(page, '/matters?page=1&pageSize=5'),
        browserApi(page, '/finance/receivables?page=1&pageSize=5'),
        browserApi(page, '/documents?page=1&pageSize=5'),
        browserApi(page, '/tasks'),
      ]);
      const membershipFinishedAt = Date.now();
      for (const [index, result] of burst.entries())
        assertStatus(result, 200, `membership burst ${index + 1}`);
      await traffic.waitForQuiet();

      const metrics = {
        environment: 'GitHub-hosted Linux; local Supabase Auth/PostgreSQL/Storage; no API mocks',
        generatedAt: new Date().toISOString(),
        navigation: traffic.toJSON(),
        financialLazyLoad: {
          expensesRequestedBeforeScroll: false,
          expenseRequestsAfterViewport: traffic.countPaths('expenses', '/v1/finance/expenses'),
        },
        membershipBurst: {
          startedAt: membershipStartedAt,
          finishedAt: membershipFinishedAt,
          requests: burst.length,
          statuses: burst.map(({ status }) => status),
        },
      };
      traffic.save(metrics, `browser-navigation-metrics-${viewport.width}.json`);
      metricsByViewport[String(viewport.width)] = metrics;
      if (viewport.width === 360) mobileMembershipBurst = metrics.membershipBurst;
      metricsSaved = true;
      expect(traffic.phase('clients').httpErrors).toEqual([]);
      expect(traffic.phase('matters').httpErrors).toEqual([]);
      expect(traffic.phase('finance').httpErrors).toEqual([]);
      expect(traffic.phase('expenses').httpErrors).toEqual([]);
      expect(traffic.phase('documents').httpErrors).toEqual([]);
      expect(traffic.phase('tasks').httpErrors).toEqual([]);
      expect(traffic.pending()).toBe(0);
      expect([...externalHosts]).toEqual([]);
    } finally {
      if (!metricsSaved)
        traffic.save(
          {
            environment: 'GitHub-hosted Linux; local Supabase; no API mocks',
            partial: true,
            navigation: traffic.toJSON(),
          },
          `browser-navigation-metrics-${viewport.width}.json`,
        );
      await context.close();
    }
  }
  writeQaArtifact('browser-navigation-metrics.json', {
    environment: 'GitHub-hosted Linux; local Supabase Auth/PostgreSQL/Storage; no API mocks',
    viewports: metricsByViewport,
    membershipBurst: mobileMembershipBurst,
  });
});

test('navegação repetida em duas sessões e organizações distintas', async ({ browser }) => {
  test.setTimeout(180_000);
  const sessions = [
    { name: 'aurora', email: 'qa-sessions.aurora@example.test' },
    { name: 'horizonte', email: 'admin.horizonte@example.test' },
  ] as const;
  const metricsByViewport: Record<string, unknown> = {};
  for (const viewport of formViewports) {
    const contexts = await Promise.all(sessions.map(() => browser.newContext({ viewport })));
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    const traffic = pages.map((page) => createTrafficRecorder(page));
    try {
      const externalHosts = await Promise.all(
        pages.map((page) => enableLocalNetworkOnly(page.context())),
      );
      await Promise.all(pages.map((page, index) => login(page, sessions[index]!.email)));

      const routes = [
        { phase: 'dashboard', nav: undefined, heading: /Vis.o geral/ },
        { phase: 'clients', nav: 'Clientes', heading: 'Clientes' },
        { phase: 'matters', nav: 'Processos', heading: 'Processos' },
        { phase: 'finance', nav: /Receb/, heading: 'Entradas, parcelas e pagamentos' },
        { phase: 'documents', nav: 'Documentos', heading: 'Documentos' },
        { phase: 'tasks', nav: 'Tarefas', heading: 'Tarefas' },
      ] as const;

      for (const route of routes) {
        for (const [index, page] of pages.entries()) {
          const sessionName = sessions[index]!.name;
          const recorder = traffic[index]!;
          const phase = `${sessionName}:${route.phase}`;
          recorder.setPhase(phase);
          const startedAt = performance.now();
          if (route.nav) await navigateTo(page, route.nav);
          await expect(
            page.getByRole('heading', { name: route.heading, exact: true }),
          ).toBeVisible();
          await recorder.waitForQuiet();
          recorder.phase(phase).perceivedLoadMs = Number(
            (performance.now() - startedAt).toFixed(2),
          );
          await screenshotEvidence(
            page,
            `two-session-${sessionName}-${route.phase}-${viewport.width}`,
          );
          expect(recorder.phase(phase).httpErrors).toEqual([]);
        }
      }

      for (const [index, page] of pages.entries()) {
        const sessionName = sessions[index]!.name;
        const recorder = traffic[index]!;
        const phase = `${sessionName}:expenses`;
        recorder.setPhase('setup');
        await navigateTo(page, /Receb/);
        await expect(
          page.getByRole('heading', { name: 'Entradas, parcelas e pagamentos', exact: true }),
        ).toBeVisible();
        await recorder.waitForQuiet();
        recorder.setPhase(phase);
        expect(recorder.countPaths(phase, '/v1/finance/expenses')).toBe(0);
        const startedAt = performance.now();
        await page.getByRole('heading', { name: 'Despesas', exact: true }).scrollIntoViewIfNeeded();
        await expect
          .poll(() => recorder.countPaths(phase, '/v1/finance/expenses'))
          .toBeGreaterThan(0);
        await recorder.waitForQuiet();
        recorder.phase(phase).perceivedLoadMs = Number((performance.now() - startedAt).toFixed(2));
        expect(recorder.phase(phase).httpErrors).toEqual([]);
        await screenshotEvidence(page, `two-session-${sessionName}-expenses-${viewport.width}`);
      }

      expect(traffic.map((recorder) => recorder.pending())).toEqual([0, 0]);
      expect(externalHosts.map((hosts) => [...hosts])).toEqual([[], []]);
      traffic[0]!.save(
        {
          environment: 'two local Auth sessions; organizations Aurora and Horizonte; no API mocks',
          viewport,
          sessions: Object.fromEntries(
            sessions.map((session, index) => [session.name, traffic[index]!.toJSON()]),
          ),
        },
        `two-session-navigation-metrics-${viewport.width}.json`,
      );
      metricsByViewport[String(viewport.width)] = Object.fromEntries(
        sessions.map((session, index) => [session.name, traffic[index]!.toJSON()]),
      );
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
    }
  }
  writeQaArtifact('two-session-navigation-metrics.json', { viewports: metricsByViewport });
});

test('jornada 1: cliente, processo, responsável e atualização de status', async ({ browser }) => {
  test.setTimeout(240_000);
  for (const viewport of formViewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    try {
      await login(page, 'qa-client-process.aurora@example.test');
      const suffix = randomUUID().slice(0, 8);
      const clientName = `Cliente QA ${suffix}`;
      await navigateTo(page, 'Clientes');
      await page.getByRole('button', { name: 'Novo cliente', exact: true }).click();
      await page.getByLabel('Nome completo', { exact: true }).fill(clientName);
      await page.getByLabel('E-mail', { exact: true }).fill('cliente-' + suffix + '@example.test');
      markWorkflowStage(page, 'journey-1-client-process-lawyer', 'client-form-ready');
      await screenshotEvidence(page, `journey-1-client-form-ready-${viewport.width}`);
      const client = await clickUiOperation(page, {
        operation: 'create-client',
        pathname: '/v1/clients',
        form: await formWithSubmitButton(page, 'Cadastrar e abrir cliente'),
        button: page.getByRole('button', { name: 'Cadastrar e abrir cliente', exact: true }),
        bodyField: { name: 'displayName', value: clientName },
      });
      expect(client.status()).toBe(201);
      expect(client.request().postDataJSON()).toMatchObject({
        type: 'PERSON',
        displayName: clientName,
      });
      const createdClient = (await client.json()) as { id: string; displayName: string };
      expect(createdClient.displayName).toBe(clientName);
      await expect(page.getByText(clientName, { exact: true }).first()).toBeVisible();
      const persistedClient = await browserApi(page, `/clients/${createdClient.id}`);
      assertStatus(persistedClient, 200, 'read client created by the UI form');
      expect(bodyAs<{ id: string; displayName: string }>(persistedClient)).toMatchObject({
        id: createdClient.id,
        displayName: clientName,
      });
      confirmPersistence(page, 'create-client');

      const reference = `QA-${suffix}`;
      const matterTitle = `Processo QA ${suffix}`;
      await navigateTo(page, 'Processos');
      await page.getByRole('button', { name: 'Novo processo', exact: true }).click();
      const matterForm = await formWithSubmitButton(page, 'Cadastrar processo');
      const matterClientId = await selectFormOptionByLabel(
        page,
        matterForm,
        'Cliente',
        clientName,
        'journey-1-client-process-lawyer',
        'matter-client',
        createdClient.id,
      );
      const pipelineId = await selectFormOptionByLabel(
        page,
        matterForm,
        'Fluxo de atendimento',
        'Juridico Local',
        'journey-1-client-process-lawyer',
        'matter-pipeline',
        '12000000-0000-4000-8000-000000000001',
      );
      await matterForm.getByLabel('Referência interna do processo').fill(reference);
      await matterForm.getByLabel('Nome do processo').fill(matterTitle);
      await expect(matterForm.getByLabel('Advogado responsável (opcional)')).toContainText(
        'Advogado Aurora',
      );
      const responsibleLawyerId = await selectFormOptionByLabel(
        page,
        matterForm,
        'Advogado responsável (opcional)',
        'Advogado Aurora',
        'journey-1-client-process-lawyer',
        'matter-responsible-lawyer',
        lawyerUserA,
      );
      markWorkflowStage(page, 'journey-1-client-process-lawyer', 'matter-form-ready');
      await screenshotEvidence(page, `journey-1-matter-form-ready-${viewport.width}`);
      const matter = await clickUiOperation(page, {
        operation: 'create-matter',
        pathname: '/v1/matters',
        form: matterForm,
        button: matterForm.getByRole('button', { name: 'Cadastrar processo' }),
        bodyField: { name: 'title', value: matterTitle },
        additionalBodyFields: [
          { name: 'clientId', value: matterClientId },
          { name: 'responsibleLawyerId', value: responsibleLawyerId },
        ],
      });
      expect(matter.status()).toBe(201);
      expect(matter.request().postDataJSON()).toMatchObject({
        clientId: matterClientId,
        pipelineId,
        responsibleLawyerId,
        reference,
        title: matterTitle,
      });
      const createdMatter = (await matter.json()) as { id: string };
      await expectOperationFeedback(page, 'Processo cadastrado.');

      const persisted = await browserApi(page, `/matters/${createdMatter.id}`);
      assertStatus(persisted, 200, 'read persisted matter');
      expect(
        bodyAs<{
          clientId: string;
          pipelineId: string;
          currentStageId: string;
          responsibleLawyerId: string;
          reference: string;
          title: string;
        }>(persisted),
      ).toMatchObject({
        clientId: createdClient.id,
        pipelineId: '12000000-0000-4000-8000-000000000001',
        currentStageId: '13000000-0000-4000-8000-000000000001',
        responsibleLawyerId: lawyerUserA,
        reference,
        title: matterTitle,
      });
      confirmPersistence(page, 'create-matter');

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
      await navigateTo(page, 'Clientes');
      await expect(page.getByText(clientName, { exact: true }).first()).toBeVisible();
      await navigateTo(page, 'Processos');
      await expect(page.getByText(reference, { exact: true })).toBeVisible();
      const createdMatterCard = page.locator('article.kanban-card').filter({ hasText: reference });
      await expect(createdMatterCard).toContainText('Advogado: Advogado Aurora');

      const statusSelect = page.getByLabel(`Status de ${matterTitle}`);
      const statusUpdate = page.waitForResponse(
        (response) =>
          response.url().includes(`/v1/matters/${createdMatter.id}`) &&
          response.request().method() === 'PATCH',
      );
      await statusSelect.selectOption('ACTIVE');
      const statusResponse = await statusUpdate;
      expect(statusResponse.status()).toBe(200);
      expect(statusResponse.request().postDataJSON()).toEqual({ status: 'ACTIVE' });
      await expectOperationFeedback(page, 'Processo atualizado.');
      const persistedStatus = await browserApi(page, `/matters/${createdMatter.id}`);
      assertStatus(persistedStatus, 200, 'read matter after status update');
      expect(bodyAs<{ status: string }>(persistedStatus).status).toBe('ACTIVE');
      confirmPersistence(page, 'update-matter-status');

      await page.getByRole('button', { name: 'Novo processo', exact: true }).click();
      const duplicateForm = await formWithSubmitButton(page, 'Cadastrar processo');
      await selectFormOptionByLabel(
        page,
        duplicateForm,
        'Cliente',
        clientName,
        'journey-1-client-process-lawyer',
        'duplicate-matter-client',
        createdClient.id,
      );
      await selectFormOptionByLabel(
        page,
        duplicateForm,
        'Fluxo de atendimento',
        'Juridico Local',
        'journey-1-client-process-lawyer',
        'duplicate-matter-pipeline',
        '12000000-0000-4000-8000-000000000001',
      );
      await duplicateForm.getByLabel('Referência interna do processo').fill(reference);
      await duplicateForm.getByLabel('Nome do processo').fill(`Duplicado ${matterTitle}`);
      await selectFormOptionByLabel(
        page,
        duplicateForm,
        'Advogado responsável (opcional)',
        'Advogado Aurora',
        'journey-1-client-process-lawyer',
        'duplicate-matter-responsible-lawyer',
        lawyerUserA,
      );
      const duplicateMatter = await clickUiOperation(page, {
        operation: 'reject-duplicate-matter',
        pathname: '/v1/matters',
        form: duplicateForm,
        button: duplicateForm.getByRole('button', { name: 'Cadastrar processo' }),
        bodyField: { name: 'title', value: `Duplicado ${matterTitle}` },
      });
      expect(duplicateMatter.status()).toBe(409);
      expect(await duplicateMatter.json()).toMatchObject({
        code: 'conflict',
        message: 'Já existe um registro com esses dados. Confira as informações e tente novamente.',
      });
      await expectOperationFeedback(
        page,
        'Erro: Já existe um registro com esses dados. Confira as informações e tente novamente.',
      );
      await screenshotEvidence(page, `journey-client-matter-${viewport.width}`);
    } finally {
      await context.close();
    }
  }
});

test('jornada 2: contrato, parcelas, saldo parcial, quitação e idempotência', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  for (const viewport of formViewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    try {
      await login(page, 'qa-finance.aurora@example.test');
      const suffix = randomUUID().slice(0, 8);
      const contractNumber = `QA-CT-${suffix}`;
      const contractTitle = `Contrato QA ${suffix}`;

      await navigateTo(page, 'Contratos');
      await page.getByRole('button', { name: 'Novo contrato', exact: true }).click();
      const contractForm = await formWithSubmitButton(page, 'Cadastrar contrato');
      const contractClientId = await selectFormOptionByLabel(
        page,
        contractForm,
        'Cliente',
        'Cliente Ficticio Alfa',
        'journey-2-contract-receivable-payment',
        'contract-client',
        clientA,
      );
      await contractForm.getByLabel('Número do contrato').fill(contractNumber);
      await contractForm.getByLabel('Nome do contrato').fill(contractTitle);
      await contractForm.getByLabel('Modelo de honorários').selectOption('FIXED');
      await contractForm.getByLabel('Valor fixo (R$)').fill('100,00');
      markWorkflowStage(page, 'journey-2-contract-receivable-payment', 'contract-form-ready');
      await screenshotEvidence(page, `journey-2-contract-form-ready-${viewport.width}`);
      const contractCreated = await clickUiOperation(page, {
        operation: 'create-contract',
        pathname: '/v1/finance/contracts',
        form: contractForm,
        button: contractForm.getByRole('button', { name: 'Cadastrar contrato' }),
        bodyField: { name: 'number', value: contractNumber },
        additionalBodyFields: [{ name: 'clientId', value: contractClientId }],
      });
      expect(contractCreated.status()).toBe(201);
      expect(contractCreated.request().postDataJSON()).toMatchObject({
        clientId: contractClientId,
        number: contractNumber,
        title: contractTitle,
        feeModel: 'FIXED',
        fixedAmount: '100.00',
      });
      const contract = (await contractCreated.json()) as { id: string; fixedAmount: string };
      expect(amountUnits(contract.fixedAmount)).toBe(amountUnits('100.00'));
      await expectOperationFeedback(page, 'Contrato cadastrado.');
      await expect(page.getByRole('row').filter({ hasText: contractNumber })).toBeVisible();

      const persistedContracts = await browserApi(page, '/finance/contracts?page=1&pageSize=100');
      assertStatus(persistedContracts, 200, 'read contract persisted from form');
      const persistedContract = bodyAs<{
        items: Array<{ id: string; clientId: string; number: string; fixedAmount: string }>;
      }>(persistedContracts).items.find((item) => item.id === contract.id);
      expect(persistedContract).toMatchObject({
        id: contract.id,
        clientId: contractClientId,
        number: contractNumber,
      });
      expect(amountUnits(persistedContract!.fixedAmount)).toBe(amountUnits('100.00'));
      confirmPersistence(page, 'create-contract');

      const reference = `QA-REC-${suffix}`;
      const issueDate = dateInput();
      const firstDueDate = dateInput(14);
      await navigateTo(page, /Receb/);
      const receivableForm = await formWithSubmitButton(page, 'Criar cobrança e parcelas');
      const receivableClientId = await selectFormOptionByLabel(
        page,
        receivableForm,
        'Cliente',
        'Cliente Ficticio Alfa',
        'journey-2-contract-receivable-payment',
        'receivable-client',
        contractClientId,
      );
      await receivableForm.getByLabel('Contrato associado (opcional)').selectOption(contract.id);
      await receivableForm.getByLabel('Código da cobrança').fill(reference);
      await receivableForm.getByLabel('Serviço ou motivo da cobrança').fill(`Honorários ${suffix}`);
      await receivableForm.getByLabel('Valor total').fill('100,00');
      await receivableForm.getByLabel('Parcelas após entrada').fill('3');
      await receivableForm.getByLabel('Data de emissão').fill(issueDate);
      await receivableForm.getByLabel('Primeiro vencimento').fill(firstDueDate);
      markWorkflowStage(page, 'journey-2-contract-receivable-payment', 'receivable-form-ready');
      await screenshotEvidence(page, `journey-2-receivable-form-ready-${viewport.width}`);
      const receivableCreated = await clickUiOperation(page, {
        operation: 'create-receivable-and-installments',
        pathname: '/v1/finance/receivables',
        form: receivableForm,
        button: receivableForm.getByRole('button', { name: 'Criar cobrança e parcelas' }),
        bodyField: { name: 'reference', value: reference },
        additionalBodyFields: [{ name: 'clientId', value: receivableClientId }],
      });
      expect(receivableCreated.status()).toBe(201);
      const receivablePayload = receivableCreated.request().postDataJSON() as {
        clientId: string;
        contractId: string;
        originalAmount: string;
        issueDate: string;
        installments: Array<{ sequence: number; amount: string; dueDate: string }>;
      };
      expect(receivablePayload.clientId).toBe(receivableClientId);
      expect(receivablePayload.contractId).toBe(contract.id);
      expect(receivablePayload.issueDate.slice(0, 10)).toBe(issueDate);
      expect(amountUnits(receivablePayload.originalAmount)).toBe(amountUnits('100.00'));
      expect(receivablePayload.installments.map(({ sequence }) => sequence)).toEqual([1, 2, 3]);
      expect(receivablePayload.installments.map(({ amount }) => amount)).toEqual([
        '33.34',
        '33.33',
        '33.33',
      ]);
      const dueDates = [firstDueDate, addMonths(firstDueDate, 1), addMonths(firstDueDate, 2)];
      expect(receivablePayload.installments.map(({ dueDate }) => dueDate.slice(0, 10))).toEqual(
        dueDates,
      );
      expect(
        receivablePayload.installments.reduce(
          (sum, installment) => sum + amountUnits(installment.amount),
          0n,
        ),
      ).toBe(amountUnits('100.00'));
      const createdReceivable = (await receivableCreated.json()) as {
        id: string;
        installments: Array<{ id: string; sequence: number; amount: string; dueDate: string }>;
      };
      expect(createdReceivable.installments.map(({ dueDate }) => dueDate.slice(0, 10))).toEqual(
        dueDates,
      );
      expect(createdReceivable.installments.map(({ amount }) => amountUnits(amount))).toEqual([
        amountUnits('33.34'),
        amountUnits('33.33'),
        amountUnits('33.33'),
      ]);
      await expectOperationFeedback(page, 'Recebível e parcelas cadastrados.');

      const persistedReceivables = await browserApi(
        page,
        `/finance/receivables?page=1&pageSize=100&clientId=${receivableClientId}&contractId=${contract.id}`,
      );
      assertStatus(persistedReceivables, 200, 'read receivable persisted from form');
      const persistedReceivable = bodyAs<{
        items: Array<{
          id: string;
          contractId: string;
          reference: string;
          originalAmount: string;
          installments: Array<{
            id: string;
            sequence: number;
            amount: string;
            dueDate: string;
            allocations: Array<{ amount: string }>;
          }>;
          status: string;
        }>;
      }>(persistedReceivables).items.find((item) => item.id === createdReceivable.id);
      expect(persistedReceivable).toMatchObject({
        contractId: contract.id,
        reference,
        status: 'OPEN',
      });
      expect(amountUnits(persistedReceivable!.originalAmount)).toBe(amountUnits('100.00'));
      expect(persistedReceivable!.installments.map(({ amount }) => amountUnits(amount))).toEqual([
        amountUnits('33.34'),
        amountUnits('33.33'),
        amountUnits('33.33'),
      ]);
      expect(persistedReceivable!.installments.map(({ dueDate }) => dueDate.slice(0, 10))).toEqual(
        dueDates,
      );
      confirmPersistence(page, 'create-receivable-and-installments');

      const receivableRow = page.getByRole('row').filter({ hasText: reference });
      await receivableRow.scrollIntoViewIfNeeded();
      await expect(receivableRow).toContainText('Saldo em aberto: R$ 100,00');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByRole('button', { name: 'Receber pagamento' }).click();
      const paymentForm = await formWithSubmitButton(page, 'Confirmar pagamento');
      const paymentClientId = await selectFormOptionByLabel(
        page,
        paymentForm,
        'Cliente',
        'Cliente Ficticio Alfa',
        'journey-2-contract-receivable-payment',
        'payment-client',
        receivableClientId,
      );

      async function submitPayment(
        installmentId: string,
        amount: string,
        paymentReference: string,
        paidAt = new Date().toISOString().slice(0, 16),
      ) {
        await paymentForm.getByLabel('Parcela').selectOption(installmentId);
        await paymentForm.getByLabel('Referência do pagamento').fill(paymentReference);
        await paymentForm.getByLabel('Valor recebido').fill(amount);
        await paymentForm.getByLabel('Data do pagamento').fill(paidAt);
        return clickUiOperation(page, {
          operation: `post-payment-${paymentReference}`,
          pathname: '/v1/finance/payments',
          form: paymentForm,
          button: paymentForm.getByRole('button', { name: 'Confirmar pagamento' }),
          bodyField: { name: 'reference', value: paymentReference },
        });
      }

      const firstInstallment = createdReceivable.installments[0]!;
      const firstOption = paymentForm
        .getByLabel('Parcela')
        .locator('option')
        .filter({
          hasText: `${reference} · parcela 1`,
        });
      await expect(firstOption).toContainText('R$ 33,34 em aberto');

      const retryReference = `QA-PG-RETRY-${suffix}`;
      const retryPaidAt = new Date().toISOString().slice(0, 16);
      const retriedKeys: string[] = [];
      await page.route('**/v1/finance/payments', async (route) => {
        retriedKeys.push(route.request().headers()['idempotency-key'] ?? '');
        if (retriedKeys.length === 1) {
          const storedResponse = await route.fetch();
          expect(storedResponse.status()).toBe(201);
          await route.abort('failed');
        } else {
          await route.continue();
        }
      });
      await paymentForm.getByLabel('Parcela').selectOption(firstInstallment.id);
      await paymentForm.getByLabel('Referência do pagamento').fill(retryReference);
      await paymentForm.getByLabel('Valor recebido').fill('10,00');
      await paymentForm.getByLabel('Data do pagamento').fill(retryPaidAt);
      await paymentForm.getByRole('button', { name: 'Confirmar pagamento' }).click();
      await expectOperationFeedback(
        page,
        'Erro: Falha de rede. Verifique sua conexão e tente novamente.',
      );
      const retriedPayment = await submitPayment(
        firstInstallment.id,
        '10,00',
        retryReference,
        retryPaidAt,
      );
      expect(retriedPayment.status()).toBe(201);
      await page.unroute('**/v1/finance/payments');
      expect(retriedKeys).toHaveLength(2);
      expect(retriedKeys[0]).toBeTruthy();
      expect(retriedKeys[1]).toBe(retriedKeys[0]);
      await expectOperationFeedback(page, 'Pagamento confirmado e alocado à parcela.');
      await expect(
        page
          .getByLabel('Parcela')
          .locator('option')
          .filter({
            hasText: `${reference} · parcela 1`,
          }),
      ).toContainText('R$ 23,34 em aberto');
      const partialReceivables = await browserApi(
        page,
        `/finance/receivables?page=1&pageSize=100&clientId=${receivableClientId}&contractId=${contract.id}`,
      );
      assertStatus(partialReceivables, 200, 'read partially paid receivable');
      expect(
        bodyAs<{ items: Array<{ id: string; status: string }> }>(partialReceivables).items.find(
          ({ id }) => id === createdReceivable.id,
        )?.status,
      ).toBe('PARTIALLY_PAID');

      const duplicatePayment = await submitPayment(firstInstallment.id, '10,00', retryReference);
      expect(duplicatePayment.status()).toBe(409);
      expect(await duplicatePayment.json()).toMatchObject({
        code: 'conflict',
        message: 'Já existe um registro com esses dados. Confira as informações e tente novamente.',
      });
      await expectOperationFeedback(
        page,
        'Erro: Já existe um registro com esses dados. Confira as informações e tente novamente.',
      );
      await expect(
        page
          .getByLabel('Parcela')
          .locator('option')
          .filter({ hasText: `${reference} · parcela 1` }),
      ).toContainText('R$ 23,34 em aberto');

      const invalidOverpayment = await submitPayment(
        firstInstallment.id,
        '23,35',
        `QA-PG-INV-${suffix}`,
      );
      expect(invalidOverpayment.status()).toBe(400);
      expect(await invalidOverpayment.json()).toMatchObject({
        code: 'bad_request',
        message: 'Alocação excede o saldo disponível da parcela',
      });
      await expectOperationFeedback(page, 'Erro: Alocação excede o saldo disponível da parcela');
      await expect(
        page
          .getByLabel('Parcela')
          .locator('option')
          .filter({
            hasText: `${reference} · parcela 1`,
          }),
      ).toContainText('R$ 23,34 em aberto');

      const firstInstallmentPaid = await submitPayment(
        firstInstallment.id,
        '23,34',
        `QA-PG-1-${suffix}`,
      );
      expect(firstInstallmentPaid.status()).toBe(201);
      await expectOperationFeedback(page, 'Pagamento confirmado e alocado à parcela.');
      const secondInstallment = createdReceivable.installments[1]!;
      const secondPaid = await submitPayment(secondInstallment.id, '33,33', `QA-PG-2-${suffix}`);
      expect(secondPaid.status()).toBe(201);
      await expectOperationFeedback(page, 'Pagamento confirmado e alocado à parcela.');
      const thirdInstallment = createdReceivable.installments[2]!;
      const thirdPaid = await submitPayment(thirdInstallment.id, '33,33', `QA-PG-3-${suffix}`);
      expect(thirdPaid.status()).toBe(201);
      await expectOperationFeedback(page, 'Pagamento confirmado e alocado à parcela.');

      const finalReceivables = await browserApi(
        page,
        `/finance/receivables?page=1&pageSize=100&clientId=${receivableClientId}&contractId=${contract.id}`,
      );
      assertStatus(finalReceivables, 200, 'read fully paid receivable');
      const finalReceivable = bodyAs<{ items: Array<typeof persistedReceivable> }>(
        finalReceivables,
      ).items.find((item) => item?.id === createdReceivable.id);
      expect(finalReceivable?.status).toBe('PAID');
      expect(
        finalReceivable?.installments.reduce(
          (sum, installment) =>
            sum +
            installment.allocations.reduce(
              (paid, allocation) => paid + amountUnits(allocation.amount),
              0n,
            ),
          0n,
        ),
      ).toBe(amountUnits('100.00'));
      const totalPaidUnits =
        finalReceivable?.installments.reduce(
          (sum, installment) =>
            sum +
            installment.allocations.reduce(
              (paid, allocation) => paid + amountUnits(allocation.amount),
              0n,
            ),
          0n,
        ) ?? 0n;
      expect(amountUnits(finalReceivable!.originalAmount) - totalPaidUnits).toBe(0n);
      confirmPersistence(page, `post-payment-QA-PG-3-${suffix}`);

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
      await navigateTo(page, /Receb/);
      const receivablesRegion = page.getByRole('region', { name: 'Recebíveis', exact: true });
      await receivablesRegion.scrollIntoViewIfNeeded();
      const completedRow = receivablesRegion.getByRole('row').filter({ hasText: reference });
      await expect(completedRow).toBeVisible({ timeout: apiOperationTimeoutMs });
      await completedRow.scrollIntoViewIfNeeded();
      await expect(completedRow).toContainText('Saldo em aberto: R$ 0,00');
      await expect(completedRow).toContainText('PAID');
      await expect(completedRow).toContainText(formatDate(dueDates.at(-1)));
      await page.getByRole('button', { name: 'Receber pagamento' }).click();
      const finalPaymentForm = await formWithSubmitButton(page, 'Confirmar pagamento');
      await selectFormOptionByLabel(
        page,
        finalPaymentForm,
        'Cliente',
        'Cliente Ficticio Alfa',
        'journey-2-contract-receivable-payment',
        'final-payment-client',
        paymentClientId,
      );
      await expect(page.getByText('Nenhuma parcela aberta para este cliente.')).toBeVisible();
      await screenshotEvidence(page, `journey-contract-receivable-payment-${viewport.width}`);
    } finally {
      await context.close();
    }
  }
});

test('jornada 3: despesa, aprovação independente, pagamento e fluxo de caixa', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  for (const viewport of formViewports) {
    const financeContext = await browser.newContext({ viewport });
    const adminContext = await browser.newContext({ viewport });
    const financePage = await financeContext.newPage();
    const adminPage = await adminContext.newPage();
    try {
      await login(financePage, 'financeiro.aurora@example.test');
      const cashFlowWindow = reportDateRange();
      const suffix = randomUUID().slice(0, 8);
      const description = `Despesa QA ${suffix}`;
      await navigateTo(financePage, /Receb/);
      await financePage.getByRole('button', { name: 'Nova despesa' }).click();
      const expenseForm = await formWithSubmitButton(financePage, 'Cadastrar despesa');
      const expenseClientId = await selectFormOptionByLabel(
        financePage,
        expenseForm,
        'Cliente',
        'Cliente Ficticio Alfa',
        'journey-3-expense-approval-payment',
        'expense-client',
        clientA,
      );
      const expenseMatterId = await selectFormOptionByLabel(
        financePage,
        expenseForm,
        'Processo',
        'AUR-001 · Cliente Ficticio Alfa',
        'journey-3-expense-approval-payment',
        'expense-matter',
        matterA,
      );
      const expenseResponsibleId = await selectFormOptionByLabel(
        financePage,
        expenseForm,
        'Responsável',
        'Financeiro Aurora',
        'journey-3-expense-approval-payment',
        'expense-responsible',
        financeUserA,
      );
      await expenseForm.getByLabel('Categoria').fill('QA sintético');
      await expenseForm.getByLabel('Detalhes da despesa').fill(description);
      await expenseForm.getByLabel('Valor').fill('42,25');
      await expenseForm.getByLabel('Data da despesa').fill(dateInput());
      await expenseForm.getByLabel('Vencimento').fill(dateInput(10));
      markWorkflowStage(financePage, 'journey-3-expense-approval-payment', 'expense-form-ready');
      await screenshotEvidence(financePage, `journey-3-expense-form-ready-${viewport.width}`);
      const createExpenseResponse = await clickUiOperation(financePage, {
        operation: 'create-expense',
        pathname: '/v1/finance/expenses',
        form: expenseForm,
        button: expenseForm.getByRole('button', { name: 'Cadastrar despesa' }),
        bodyField: { name: 'description', value: description },
        additionalBodyFields: [
          { name: 'clientId', value: expenseClientId },
          { name: 'matterId', value: expenseMatterId },
          { name: 'responsibleUserId', value: expenseResponsibleId },
        ],
      });
      expect(createExpenseResponse.status()).toBe(201);
      const expenseId = ((await createExpenseResponse.json()) as { id: string }).id;
      await expectOperationFeedback(financePage, 'Despesa cadastrada.');
      await pageExpenseSection(financePage);
      let expenseRow = financePage.getByRole('row').filter({ hasText: description });
      await expect(expenseRow).toContainText('Rascunho');
      const submitExpenseResponse = await clickUiOperation(financePage, {
        operation: 'submit-expense-for-approval',
        pathname: `/v1/finance/expenses/${expenseId}/submit`,
        button: expenseRow.getByRole('button', { name: 'Enviar para aprovação' }),
      });
      expect(submitExpenseResponse.status()).toBe(201);
      await expectOperationFeedback(financePage, 'Despesa enviada para aprovação.');
      await expect(expenseRow).toContainText('Aguardando aprovação');

      await login(adminPage, 'qa-expense-approver.aurora@example.test');
      await navigateTo(adminPage, /Receb/);
      await pageExpenseSection(adminPage);
      expenseRow = adminPage.getByRole('row').filter({ hasText: description });
      await expect(expenseRow).toContainText('Aguardando aprovação');
      const approveExpenseResponse = await clickUiOperation(adminPage, {
        operation: 'approve-expense-as-another-user',
        pathname: `/v1/finance/expenses/${expenseId}/approve`,
        button: expenseRow.getByRole('button', { name: 'Aprovar' }),
      });
      expect(approveExpenseResponse.status()).toBe(201);
      await expectOperationFeedback(adminPage, 'Despesa aprovada.');
      await expect(expenseRow).toContainText('Aguardando pagamento');

      const cashFlowBeforePayment = await browserApi(
        adminPage,
        `/reports/cash-flow?${reportRange(cashFlowWindow)}`,
      );
      assertStatus(cashFlowBeforePayment, 200, 'read cash flow before expense payment');
      const paidExpensesBeforePayment = cashFlowPaidExpenseUnits(
        bodyAs<{ rows: Array<{ paid_expenses: string }> }>(cashFlowBeforePayment).rows,
      );

      await expenseRow.getByRole('button', { name: 'Registrar pagamento' }).click();
      await adminPage.getByLabel('Valor integral').fill('42,25');
      await adminPage.getByLabel('Data do pagamento').fill(dateInput());
      await adminPage.getByLabel('Forma de pagamento').fill('PIX');
      await adminPage.getByLabel('Referência').fill(`QA-${suffix}`);
      const paymentForm = await formWithSubmitButton(adminPage, 'Confirmar quitação integral');
      const payExpenseResponse = await clickUiOperation(adminPage, {
        operation: 'pay-approved-expense',
        pathname: `/v1/finance/expenses/${expenseId}/payment`,
        form: paymentForm,
        button: paymentForm.getByRole('button', { name: 'Confirmar quitação integral' }),
        bodyField: { name: 'reference', value: `QA-${suffix}` },
      });
      expect(payExpenseResponse.status()).toBe(201);
      await expectOperationFeedback(adminPage, 'Pagamento integral registrado no caixa.');
      await expect(expenseRow).toContainText('Paga');

      const persistedExpenses = await browserApi(
        adminPage,
        '/finance/expenses?page=1&pageSize=100',
      );
      assertStatus(persistedExpenses, 200, 'read persisted paid expense');
      const persistedExpense = bodyAs<{
        items: Array<{
          description: string;
          status: string;
          amount: string;
          clientId: string;
          matterId: string;
          responsibleUserId: string;
        }>;
      }>(persistedExpenses).items.find((item) => item.description === description);
      expect(persistedExpense).toMatchObject({
        description,
        status: 'PAID',
        amount: '42.25',
        clientId: expenseClientId,
        matterId: expenseMatterId,
        responsibleUserId: expenseResponsibleId,
      });
      confirmPersistence(adminPage, 'pay-approved-expense');

      const expenseAudit = await browserApi(
        adminPage,
        `/audit-logs?category=changes&page=1&pageSize=100&search=${encodeURIComponent(expenseId)}`,
      );
      assertStatus(expenseAudit, 200, 'read expense audit trail');
      const expenseAuditEntries = bodyAs<{
        items: Array<{
          kind: string;
          action: string;
          resource: string;
          resourceId: string;
          actorUserId?: string;
        }>;
      }>(expenseAudit).items.filter(
        (entry) =>
          entry.kind === 'CHANGE' && entry.resource === 'expense' && entry.resourceId === expenseId,
      );
      expect(expenseAuditEntries.map(({ action }) => action)).toEqual(
        expect.arrayContaining(['CREATE', 'UPDATE', 'APPROVE']),
      );
      expect(expenseAuditEntries.length).toBeGreaterThanOrEqual(4);
      const expenseCreator = expenseAuditEntries.find(({ action }) => action === 'CREATE');
      const expenseApprover = expenseAuditEntries.find(({ action }) => action === 'APPROVE');
      expect(expenseCreator?.actorUserId).toBeTruthy();
      expect(expenseApprover?.actorUserId).toBeTruthy();
      expect(expenseApprover?.actorUserId).not.toBe(expenseCreator?.actorUserId);

      const cashFlow = await browserApi(
        adminPage,
        `/reports/cash-flow?${reportRange(cashFlowWindow)}`,
      );
      assertStatus(cashFlow, 200, 'read cash flow');
      const rows = bodyAs<{ rows: Array<{ paid_expenses: string }> }>(cashFlow).rows;
      const paidExpensesAfterPayment = cashFlowPaidExpenseUnits(rows);
      expect(paidExpensesAfterPayment - paidExpensesBeforePayment).toBe(
        amountUnits(persistedExpense!.amount),
      );

      await adminPage.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
      await navigateTo(adminPage, /Receb/);
      await pageExpenseSection(adminPage);
      const paidExpenseRow = adminPage.getByRole('row').filter({ hasText: description });
      await expect(paidExpenseRow).toContainText('Paga');
      await screenshotEvidence(adminPage, `journey-expense-paid-${viewport.width}`);
      await navigateTo(adminPage, 'Relatórios');
      await expect(
        adminPage.getByRole('heading', { name: 'Relatórios', exact: true }),
      ).toBeVisible();
      const reportFilters = adminPage.locator('.report-filters');
      await reportFilters.getByLabel('Relatório').selectOption('cash-flow');
      await reportFilters.getByLabel('Data inicial').fill(cashFlowWindow.fromDate);
      await reportFilters.getByLabel('Data final').fill(cashFlowWindow.toDate);
      const displayedCashFlowPromise = adminPage.waitForResponse((response) => {
        const url = new URL(response.url());
        return (
          url.pathname.endsWith('/v1/reports/cash-flow') &&
          url.searchParams.get('groupBy') === 'day' &&
          url.searchParams.get('from') === cashFlowWindow.fromDate &&
          url.searchParams.get('to') === cashFlowWindow.toDate
        );
      });
      await reportFilters.getByLabel('Agrupar por').selectOption('day');
      const displayedCashFlow = await displayedCashFlowPromise;
      expect(displayedCashFlow.status()).toBe(200);
      const displayedRows = (
        (await displayedCashFlow.json()) as { rows: Array<{ paid_expenses: string }> }
      ).rows;
      expect(displayedRows.map(({ paid_expenses }) => amountUnits(paid_expenses))).toEqual(
        rows.map(({ paid_expenses }) => amountUnits(paid_expenses)),
      );
      const reportTable = adminPage.getByRole('table');
      const headers = await reportTable.locator('thead th').allTextContents();
      const paidExpensesColumn = headers.findIndex(
        (header) => header.trim().toLowerCase() === 'paid expenses',
      );
      expect(paidExpensesColumn).toBeGreaterThanOrEqual(0);
      const renderedRows = reportTable.locator('tbody tr');
      await expect(renderedRows).toHaveCount(displayedRows.length);
      for (const [index, row] of displayedRows.entries()) {
        await expect(renderedRows.nth(index).locator('td').nth(paidExpensesColumn)).toHaveText(
          formatCurrencyUnits(amountUnits(row.paid_expenses)),
        );
      }
      await screenshotEvidence(adminPage, `journey-expense-cash-flow-${viewport.width}`);
    } finally {
      await financeContext.close();
      await adminContext.close();
    }
  }
});

async function pageExpenseSection(page: Page) {
  await page.getByRole('heading', { name: 'Despesas', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading', { name: 'Despesas', exact: true })).toBeVisible();
}

async function submitScannerProbe(page: Page, title: string, operation: string) {
  const form = page.getByLabel('Nome do documento').locator('xpath=ancestor::form');
  if ((await form.count()) === 0)
    await page.getByRole('button', { name: 'Enviar documento', exact: true }).click();
  await expect(form, `${operation}: document form`).toHaveCount(1);
  await expect(form).toBeVisible();
  await form.getByLabel('Nome do documento').fill(title);
  await form.getByLabel('Visibilidade').selectOption('INTERNAL');
  await form.getByLabel('Arquivo').setInputFiles({
    name: `${operation}.pdf`,
    mimeType: 'application/pdf',
    buffer: await pdfBytes(),
  });
  return clickUiOperation(page, {
    operation,
    pathname: '/v1/documents',
    form,
    button: form.getByRole('button', { name: 'Enviar documento', exact: true }),
    bodyField: { name: 'title', value: title },
  });
}

async function expectNoPersistedDocument(page: Page, title: string) {
  await expect(page.getByRole('row').filter({ hasText: title })).toHaveCount(0);
  const response = await browserApi(page, '/documents?page=1&pageSize=100');
  assertStatus(response, 200, `confirm blocked upload is absent: ${title}`);
  const items = bodyAs<{ items: Array<{ title: string }> }>(response).items;
  expect(items.some((document) => document.title === title)).toBe(false);
}

async function storageObjectInventory(organizationId: string): Promise<string[]> {
  if (!storageAdminKey) throw new Error('Local Storage verification key is missing.');
  const storageAdmin = createClient(supabaseUrl, storageAdminKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const objects: string[] = [];
  const visit = async (prefix: string, depth: number): Promise<void> => {
    if (depth > 4) throw new Error('Storage folder depth exceeds the synthetic test bound.');
    let offset = 0;
    while (true) {
      const { data, error } = await storageAdmin.storage.from(storageBucket).list(prefix, {
        limit: 1000,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) throw new Error(`Local Storage inventory failed: ${error.name}`);
      for (const item of data) {
        const path = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.id === null) await visit(path, depth + 1);
        else objects.push(path);
      }
      if (data.length < 1000) break;
      offset += data.length;
    }
  };
  await visit(`organizations/${organizationId}/documents`, 0);
  return objects.sort();
}

async function expectStorageUnchanged(
  organizationId: string,
  previousObjects: string[],
  label: string,
  page?: Page,
) {
  const currentObjects = await storageObjectInventory(organizationId);
  expect(currentObjects, `${label}: rejected upload must not promote an object to Storage`).toEqual(
    previousObjects,
  );
  if (page)
    markWorkflowStage(page, label, 'STORAGE_PROMOTION_BLOCKED', {
      storageObjectCount: currentObjects.length,
    });
}

async function expectStorageAddedOne(
  organizationId: string,
  previousObjects: string[],
  page: Page,
  operation: string,
) {
  const currentObjects = await storageObjectInventory(organizationId);
  expect(currentObjects).toHaveLength(previousObjects.length + 1);
  expect(currentObjects.filter((object) => !previousObjects.includes(object))).toHaveLength(1);
  markWorkflowStage(page, operation, 'STORAGE_OBJECT_CONFIRMED', {
    storageObjectCount: currentObjects.length,
  });
  return currentObjects;
}

test('jornada 4: upload, download protegido e assinatura eletrônica no navegador', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  for (const viewport of formViewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    try {
      await login(page, 'qa-documents.aurora@example.test');
      const suffix = randomUUID().slice(0, 8);
      const title = `PDF de assinatura QA ${suffix}`;
      const cleanPdf = await pdfBytes();
      const storageBeforeCleanUpload = await storageObjectInventory(organizationA);
      await navigateTo(page, 'Documentos');
      await page.getByRole('button', { name: 'Enviar documento', exact: true }).click();
      const uploadForm = await formWithSubmitButton(page, 'Enviar documento');
      await uploadForm.getByLabel('Nome do documento').fill(title);
      await uploadForm.getByLabel('Tipo de documento (opcional)').fill('QA');
      await uploadForm.getByLabel('Visibilidade').selectOption('CLIENT');
      const documentClientId = await selectFormOptionByLabel(
        page,
        uploadForm,
        'Cliente',
        'Cliente Ficticio Alfa',
        'journey-4-document-upload-download-signature',
        'document-client',
        clientA,
      );
      await uploadForm.getByLabel('Arquivo').setInputFiles({
        name: `qa-${suffix}.pdf`,
        mimeType: 'application/pdf',
        buffer: cleanPdf,
      });
      markWorkflowStage(page, 'journey-4-document-upload-download-signature', 'upload-form-ready');
      await screenshotEvidence(page, `journey-4-upload-form-ready-${viewport.width}`);
      const uploaded = await clickUiOperation(page, {
        operation: 'upload-client-document',
        pathname: '/v1/documents',
        form: uploadForm,
        button: uploadForm.getByRole('button', { name: 'Enviar documento' }),
        bodyField: { name: 'title', value: title },
        additionalBodyFields: [{ name: 'clientId', value: documentClientId }],
      });
      expect(uploaded.status()).toBe(201);
      const uploadFields = uploaded.request().postDataBuffer()?.toString('latin1') ?? '';
      expect(uploadFields).toContain(title);
      expect(uploadFields).toContain('visibility');
      await expectOperationFeedback(page, 'Documento enviado com segurança.');
      const documentId = ((await uploaded.json()) as { id: string }).id;
      const storageAfterCleanUpload = await expectStorageAddedOne(
        organizationA,
        storageBeforeCleanUpload,
        page,
        'upload-client-document',
      );
      const documentRow = page.getByRole('row').filter({ hasText: title });
      await expect(documentRow).toBeVisible();
      await expect(documentRow).toContainText('Cliente');

      const infectedTitle = `Arquivo de teste bloqueado QA ${suffix}`;
      const storageBeforeInfectedUpload = storageAfterCleanUpload;
      await page.getByRole('button', { name: 'Enviar documento', exact: true }).click();
      const infectedForm = await formWithSubmitButton(page, 'Enviar documento');
      await infectedForm.getByLabel('Nome do documento').fill(infectedTitle);
      await infectedForm.getByLabel('Visibilidade').selectOption('INTERNAL');
      await infectedForm.getByLabel('Arquivo').setInputFiles({
        name: `eicar-${suffix}.pdf`,
        mimeType: 'application/pdf',
        buffer: await pdfBytes(eicarTestFile),
      });
      const infectedResponse = await clickUiOperation(page, {
        operation: 'reject-infected-document-upload',
        pathname: '/v1/documents',
        form: infectedForm,
        button: infectedForm.getByRole('button', { name: 'Enviar documento' }),
        bodyField: { name: 'title', value: infectedTitle },
      });
      expect(infectedResponse.status()).toBe(422);
      expect(await infectedResponse.json()).toMatchObject({
        code: 'unprocessable_entity',
        message: 'O arquivo foi bloqueado pela verificação de segurança.',
      });
      await expectOperationFeedback(
        page,
        'Erro: O arquivo foi bloqueado pela verificação de segurança.',
      );
      await expect(page.getByRole('row').filter({ hasText: infectedTitle })).toHaveCount(0);
      await expectStorageUnchanged(
        organizationA,
        storageBeforeInfectedUpload,
        'infected-upload',
        page,
      );

      const persistedDocuments = await browserApi(page, '/documents?page=1&pageSize=100');
      assertStatus(persistedDocuments, 200, 'read uploaded document metadata');
      expect(
        bodyAs<{
          items: Array<{ id: string; title: string; clientId: string; visibility: string }>;
        }>(persistedDocuments).items.find((item) => item.id === documentId),
      ).toMatchObject({ id: documentId, title, clientId: documentClientId, visibility: 'CLIENT' });
      confirmPersistence(page, 'upload-client-document');

      const storageResponsePromise = page
        .context()
        .waitForEvent('response', (response) =>
          new URL(response.url()).pathname.startsWith('/storage/v1/object/sign/legal-documents/'),
        );
      const popupPromise = page.waitForEvent('popup');
      const signedUrl = await clickUiOperation(page, {
        operation: 'request-protected-document-download',
        pathname: `/v1/documents/${documentId}/download-url`,
        method: 'GET',
        button: documentRow.getByRole('button', { name: 'Abrir' }),
      });
      const documentPage = await popupPromise;
      expect(signedUrl.status()).toBe(200);
      const downloadUrl = ((await signedUrl.json()) as { url: string }).url;
      expect(new URL(downloadUrl).hostname).toBe('127.0.0.1');
      const downloadResponse = await storageResponsePromise;
      expect(new URL(downloadResponse.url()).pathname).toBe(new URL(downloadUrl).pathname);
      expect(downloadResponse.status()).toBe(200);
      expect(downloadResponse.headers()['content-type']).toContain('application/pdf');
      const downloadedBytes = await downloadResponse.body();
      const uploadedChecksum = createHash('sha256').update(cleanPdf).digest('hex');
      const downloadedChecksum = createHash('sha256').update(downloadedBytes).digest('hex');
      expect(downloadedChecksum).toBe(uploadedChecksum);
      recordOperationStage(page, 'request-protected-document-download', 'DOWNLOAD_BYTES_CONFIRMED');
      await documentPage.close();

      await documentRow.getByRole('button', { name: 'Solicitar assinatura' }).click();
      const requestDialog = page.getByRole('dialog', { name: 'Enviar para assinatura' });
      await requestDialog.getByLabel('Nome de quem assinará').fill('Cliente Ficticio Alfa');
      await requestDialog.getByLabel('Validade do link').selectOption('3');
      const requested = await clickUiOperation(page, {
        operation: 'request-document-signature',
        pathname: `/v1/documents/${documentId}/signature-requests`,
        form: requestDialog.locator('form'),
        button: requestDialog.getByRole('button', { name: 'Criar link de assinatura' }),
        bodyField: { name: 'signerName', value: 'Cliente Ficticio Alfa' },
      });
      expect(requested.status()).toBe(201);
      expect(requested.request().postDataJSON()).toMatchObject({
        signerName: 'Cliente Ficticio Alfa',
        expiresInDays: 3,
      });
      const shareDialog = page.getByRole('dialog', { name: /Compartilhar com/ });
      const signingLink = await shareDialog.getByLabel('Link de assinatura').inputValue();
      const signingPath = new URL(signingLink).pathname;
      expect(signingPath.startsWith('/assinar/')).toBe(true);
      expect(signingPath.split('/').at(-1)?.length).toBe(64);
      await expect(documentRow).toContainText('Aguardando Cliente Ficticio Alfa');
      recordOperationStage(page, 'request-document-signature', 'SIGNATURE_LINK_VISIBLE');
      const persistedSignatureDocuments = await browserApi(page, '/documents?page=1&pageSize=100');
      assertStatus(persistedSignatureDocuments, 200, 'read persisted signature request');
      const persistedSignature = bodyAs<{
        items: Array<{
          id: string;
          signingRequests?: Array<{ signerName: string; status: string }>;
        }>;
      }>(persistedSignatureDocuments).items.find((item) => item.id === documentId)
        ?.signingRequests?.[0];
      expect(persistedSignature).toMatchObject({
        signerName: 'Cliente Ficticio Alfa',
        status: 'PENDING',
      });
      confirmPersistence(page, 'request-document-signature');
      await shareDialog.getByRole('button', { name: 'Fechar' }).click();

      const invalidTitle = `Arquivo inválido QA ${suffix}`;
      await page.getByRole('button', { name: 'Enviar documento', exact: true }).click();
      const invalidForm = await formWithSubmitButton(page, 'Enviar documento');
      await invalidForm.getByLabel('Nome do documento').fill(invalidTitle);
      await invalidForm.getByLabel('Visibilidade').selectOption('INTERNAL');
      await invalidForm.getByLabel('Arquivo').setInputFiles({
        name: `invalid-${suffix}.pdf`,
        mimeType: 'application/pdf',
        buffer: Buffer.from('not a PDF document'),
      });
      const invalidResponse = await clickUiOperation(page, {
        operation: 'reject-invalid-document-upload',
        pathname: '/v1/documents',
        form: invalidForm,
        button: invalidForm.getByRole('button', { name: 'Enviar documento' }),
        bodyField: { name: 'title', value: invalidTitle },
      });
      expect(invalidResponse.status()).toBe(400);
      expect(await invalidResponse.json()).toMatchObject({
        code: 'bad_request',
        message: 'Tipo de arquivo não permitido ou conteúdo incompatível',
      });
      await expectOperationFeedback(
        page,
        'Erro: Tipo de arquivo não permitido ou conteúdo incompatível',
      );
      await expect(page.getByRole('row').filter({ hasText: invalidTitle })).toHaveCount(0);

      const oversizedTitle = `Arquivo grande QA ${suffix}`;
      await page.getByRole('button', { name: 'Enviar documento', exact: true }).click();
      const oversizedForm = await formWithSubmitButton(page, 'Enviar documento');
      await oversizedForm.getByLabel('Nome do documento').fill(oversizedTitle);
      await oversizedForm.getByLabel('Visibilidade').selectOption('INTERNAL');
      await oversizedForm.getByLabel('Arquivo').setInputFiles({
        name: `large-${suffix}.pdf`,
        mimeType: 'application/pdf',
        buffer: Buffer.alloc(4 * 1024 * 1024 + 1, 0x41),
      });
      const oversizedResponse = await clickUiOperation(page, {
        operation: 'reject-oversized-document-upload',
        pathname: '/v1/documents',
        form: oversizedForm,
        button: oversizedForm.getByRole('button', { name: 'Enviar documento' }),
        bodyField: { name: 'title', value: oversizedTitle },
      });
      expect(oversizedResponse.status()).toBe(413);
      expect(await oversizedResponse.json()).toMatchObject({
        code: 'payload_too_large',
        message: 'A requisição excede o limite de upload.',
      });
      await expectOperationFeedback(page, 'Erro: A requisição excede o limite de upload.');
      await expect(page.getByRole('row').filter({ hasText: oversizedTitle })).toHaveCount(0);

      if (
        process.env.LIVIO_CLAMAV_INTEGRATION_FAILURES === 'true' &&
        process.env.LIVIO_PLAYWRIGHT_RUN === 'focused' &&
        viewport.width === 360
      ) {
        const container = ownedClamavContainer();
        const timeoutTitle = `Upload bloqueado por timeout QA ${suffix}`;
        const storageBeforeTimeout = await storageObjectInventory(organizationA);
        controlClamavContainer('pause', container);
        try {
          const timeoutStartedAt = Date.now();
          const timeoutResponse = await submitScannerProbe(
            page,
            timeoutTitle,
            'clamav-timeout-upload',
          );
          const timeoutElapsedMs = Date.now() - timeoutStartedAt;
          expect(timeoutResponse.status()).toBe(503);
          expect(timeoutElapsedMs).toBeGreaterThanOrEqual(8_500);
          const timeoutBody = await timeoutResponse.json();
          expect(timeoutBody).toMatchObject({
            statusCode: 503,
            code: 'service_unavailable',
            message: 'Ocorreu um erro interno',
          });
          await expectOperationFeedback(page, 'Erro: Ocorreu um erro interno');
          await expectNoPersistedDocument(page, timeoutTitle);
          await expectStorageUnchanged(
            organizationA,
            storageBeforeTimeout,
            'scanner-timeout',
            page,
          );
          markWorkflowStage(page, 'document-upload-clamav-timeout', 'TIMEOUT_BLOCKED', {
            status: timeoutResponse.status(),
            code: timeoutBody.code,
            message: timeoutBody.message,
            elapsedMs: timeoutElapsedMs,
            documentPersisted: false,
          });
          await screenshotEvidence(page, 'clamav-timeout-blocked-upload');
        } finally {
          controlClamavContainer('unpause', container);
        }

        const unavailableTitle = `Upload bloqueado sem scanner QA ${suffix}`;
        const storageBeforeUnavailable = await storageObjectInventory(organizationA);
        controlClamavContainer('stop', container);
        try {
          const unavailableResponse = await submitScannerProbe(
            page,
            unavailableTitle,
            'clamav-unavailable-upload',
          );
          expect(unavailableResponse.status()).toBe(503);
          const unavailableBody = await unavailableResponse.json();
          expect(unavailableBody).toMatchObject({
            statusCode: 503,
            code: 'service_unavailable',
            message: 'Ocorreu um erro interno',
          });
          await expectOperationFeedback(page, 'Erro: Ocorreu um erro interno');
          await expectNoPersistedDocument(page, unavailableTitle);
          await expectStorageUnchanged(
            organizationA,
            storageBeforeUnavailable,
            'scanner-unavailable',
            page,
          );
          markWorkflowStage(page, 'document-upload-clamav-unavailable', 'UNAVAILABLE_BLOCKED', {
            status: unavailableResponse.status(),
            code: unavailableBody.code,
            message: unavailableBody.message,
            documentPersisted: false,
          });
          await screenshotEvidence(page, 'clamav-unavailable-blocked-upload');
        } finally {
          controlClamavContainer('start', container);
        }

        const recoveryDeadline = Date.now() + 90_000;
        let recoveredDocument = false;
        let recoveryAttempt = 0;
        while (Date.now() < recoveryDeadline && !recoveredDocument) {
          recoveryAttempt += 1;
          const recoveryTitle = `Upload liberado apos recuperacao QA ${suffix} ${recoveryAttempt}`;
          const recoveryOperation = `clamav-recovery-upload-${recoveryAttempt}`;
          const recoveryResponse = await submitScannerProbe(page, recoveryTitle, recoveryOperation);
          if (recoveryResponse.status() === 201) {
            const document = (await recoveryResponse.json()) as { id: string; title: string };
            expect(document.title).toBe(recoveryTitle);
            await expectOperationFeedback(page, 'Documento enviado com seguranÃ§a.');
            await expect(page.getByRole('row').filter({ hasText: recoveryTitle })).toBeVisible();
            const persistedResponse = await browserApi(page, '/documents?page=1&pageSize=100');
            assertStatus(persistedResponse, 200, 'confirm upload after ClamAV recovery');
            expect(
              bodyAs<{ items: Array<{ id: string; title: string }> }>(persistedResponse).items,
            ).toContainEqual(expect.objectContaining({ id: document.id, title: recoveryTitle }));
            confirmPersistence(page, recoveryOperation);
            recoveredDocument = true;
          } else {
            expect(recoveryResponse.status()).toBe(503);
            await expectOperationFeedback(page, 'Erro: Ocorreu um erro interno');
            await page.waitForTimeout(1_000);
          }
        }
        expect(recoveredDocument, 'ClamAV must accept uploads after the runner restarts it').toBe(
          true,
        );
      }

      await screenshotEvidence(page, `journey-document-signed-${viewport.width}`);
    } finally {
      await context.close();
    }
  }
});

test('jornada 5: tarefa atribuída a advogado e concluída', async ({ browser }) => {
  test.setTimeout(240_000);
  for (const viewport of formViewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    try {
      await login(page, 'qa-tasks.aurora@example.test');
      const suffix = randomUUID().slice(0, 8);
      const title = `Tarefa QA ${suffix}`;
      await navigateTo(page, 'Tarefas');
      await page.getByRole('button', { name: 'Nova tarefa' }).click();
      await page.getByLabel('O que precisa ser feito').fill(title);
      const taskForm = await formWithSubmitButton(page, 'Criar tarefa');
      await taskForm.locator('select[name="priority"]').selectOption('HIGH');
      await expect(taskForm.locator('select[name="assigneeId"]')).toBeEnabled();
      await taskForm.locator('select[name="assigneeId"]').selectOption(lawyerUserA);
      const created = await clickUiOperation(page, {
        operation: 'create-task',
        pathname: '/v1/tasks',
        form: taskForm,
        button: taskForm.getByRole('button', { name: 'Criar tarefa', exact: true }),
        bodyField: { name: 'title', value: title },
      });
      expect(created.status()).toBe(201);
      expect(created.request().postDataJSON()).toMatchObject({
        title,
        assigneeId: lawyerUserA,
        priority: 'HIGH',
      });
      const taskId = ((await created.json()) as { id: string }).id;
      await expectOperationFeedback(page, 'Tarefa criada.');
      const completeTaskResponse = await clickUiOperation(page, {
        operation: 'complete-assigned-task',
        pathname: `/v1/tasks/${taskId}`,
        method: 'PATCH',
        action: () => page.getByLabel(`Status de ${title}`).selectOption('COMPLETED'),
        bodyField: { name: 'status', value: 'COMPLETED' },
      });
      expect(completeTaskResponse.status()).toBe(200);
      await expectOperationFeedback(page, 'Tarefa atualizada.');
      const persisted = await browserApi(page, '/tasks');
      assertStatus(persisted, 200, 'read persisted tasks');
      expect(
        bodyAs<Array<{ id: string; status: string }>>(persisted).find((task) => task.id === taskId)
          ?.status,
      ).toBe('COMPLETED');

      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20_000 });
      await navigateTo(page, 'Tarefas');
      await expect(page.getByText(title, { exact: true })).toBeVisible();
      await expect(page.getByLabel(`Status de ${title}`)).toHaveValue('COMPLETED');
      confirmPersistence(page, 'complete-assigned-task');
      await screenshotEvidence(page, `journey-task-completed-${viewport.width}`);
    } finally {
      await context.close();
    }
  }
});

test('jornada 6: portal, documento privado por cliente, mensagem persistida e isolamento', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  for (const viewport of formViewports) {
    const adminContext = await browser.newContext({ viewport });
    const clientContext = await browser.newContext({ viewport });
    const secondClientContext = await browser.newContext({ viewport });
    const otherOrganizationContext = await browser.newContext({ viewport });
    const otherOrganizationClientContext = await browser.newContext({ viewport });
    const adminPage = await adminContext.newPage();
    const clientPage = await clientContext.newPage();
    const secondClientPage = await secondClientContext.newPage();
    const otherOrganizationPage = await otherOrganizationContext.newPage();
    const otherOrganizationClientPage = await otherOrganizationClientContext.newPage();
    try {
      await login(adminPage, 'qa-portal.aurora@example.test');
      const suffix = randomUUID().slice(0, 8);
      const visibleTitle = `Documento do portal QA ${suffix}`;
      const internalTitle = `Documento interno QA ${suffix}`;
      const image = [
        ...Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=',
          'base64',
        ),
      ];
      const visible = await browserUpload(
        adminPage,
        { title: visibleTitle, category: 'QA', visibility: 'CLIENT', clientId: clientA },
        `portal-${suffix}.png`,
        'image/png',
        image,
      );
      assertStatus(visible, 201, 'upload client-visible file');
      const visibleDocumentId = bodyAs<{ id: string }>(visible).id;
      const internal = await browserUpload(
        adminPage,
        { title: internalTitle, category: 'QA', visibility: 'INTERNAL', clientId: clientA },
        `internal-${suffix}.png`,
        'image/png',
        image,
      );
      assertStatus(internal, 201, 'upload internal-only file');
      const internalId = bodyAs<{ id: string }>(internal).id;
      const secondClientTitle = `Documento do portal Beta QA ${suffix}`;
      const secondClientDocument = await browserUpload(
        adminPage,
        { title: secondClientTitle, category: 'QA', visibility: 'CLIENT', clientId: clientB },
        `portal-beta-${suffix}.png`,
        'image/png',
        image,
      );
      assertStatus(secondClientDocument, 201, 'prepare another client document in the same office');
      const secondClientDocumentId = bodyAs<{ id: string }>(secondClientDocument).id;

      await login(otherOrganizationPage, 'admin.horizonte@example.test');
      const otherOrganizationTitle = `Documento Horizonte QA ${suffix}`;
      const otherOrganizationDocument = await browserUpload(
        otherOrganizationPage,
        {
          title: otherOrganizationTitle,
          category: 'QA',
          visibility: 'CLIENT',
          clientId: clientOrganizationB,
        },
        `portal-horizonte-${suffix}.png`,
        'image/png',
        image,
        organizationB,
      );
      assertStatus(otherOrganizationDocument, 201, 'prepare document in second organization');
      const otherOrganizationDocumentId = bodyAs<{ id: string }>(otherOrganizationDocument).id;

      await login(otherOrganizationClientPage, 'cliente.horizonte@example.test');
      await expect(
        otherOrganizationClientPage.getByRole('heading', { name: /Minha/ }),
      ).toBeVisible();
      await expect(
        otherOrganizationClientPage.getByRole('button', {
          name: new RegExp(otherOrganizationTitle),
        }),
      ).toBeVisible();
      await expect(
        otherOrganizationClientPage.getByText(visibleTitle, { exact: true }),
      ).toHaveCount(0);
      await expect(
        otherOrganizationClientPage.getByText(secondClientTitle, { exact: true }),
      ).toHaveCount(0);
      const crossOrganizationDocument = await browserApi(
        otherOrganizationClientPage,
        `/documents/${visibleDocumentId}`,
        { organizationId: organizationB },
      );
      assertAuthorizationDenial(crossOrganizationDocument, {
        status: 404,
        code: 'not_found',
        message: 'Documento não encontrado',
        label: 'client cannot read a document from another organization',
      });
      const crossOrganizationClientList = await browserApi(
        otherOrganizationClientPage,
        '/clients?page=1&pageSize=5',
        { organizationId: organizationA },
      );
      assertAuthorizationDenial(crossOrganizationClientList, {
        status: 401,
        code: 'unauthorized',
        message: 'Usuário sem vínculo ativo com esta organização',
        label: 'client cannot select another organization',
      });

      await login(clientPage, 'cliente.aurora@example.test');
      await expect(clientPage.getByRole('heading', { name: /Minha/ })).toBeVisible();
      await expect(
        clientPage.getByRole('button', { name: new RegExp(visibleTitle) }),
      ).toBeVisible();
      await expect(clientPage.getByText(internalTitle, { exact: true })).toHaveCount(0);
      await expect(clientPage.getByText(secondClientTitle, { exact: true })).toHaveCount(0);
      await screenshotEvidence(clientPage, `journey-client-portal-${viewport.width}`);

      const forbiddenInternal = await browserApi(clientPage, `/documents/${internalId}`);
      assertAuthorizationDenial(forbiddenInternal, {
        status: 404,
        code: 'not_found',
        message: 'Documento não encontrado',
        label: 'client cannot read internal document',
      });
      const forbiddenSameOrganization = await browserApi(
        clientPage,
        `/documents/${secondClientDocumentId}`,
      );
      assertAuthorizationDenial(forbiddenSameOrganization, {
        status: 404,
        code: 'not_found',
        message: 'Documento não encontrado',
        label: 'client cannot read another client document',
      });
      const crossOrganization = await browserApi(clientPage, '/clients?page=1&pageSize=5', {
        organizationId: organizationB,
      });
      assertAuthorizationDenial(crossOrganization, {
        status: 401,
        code: 'unauthorized',
        message: 'Usuário sem vínculo ativo com esta organização',
        label: 'client cannot select another organization',
      });

      const message = `Mensagem sintética QA ${suffix}`;
      await clientPage.getByLabel(/Responder ao escrit/).fill(message);
      await clientPage.getByRole('button', { name: 'Enviar mensagem' }).click();
      await expectOperationFeedback(clientPage, 'Mensagem enviada à equipe.');
      await expect(clientPage.getByText(message, { exact: true })).toBeVisible();
      const persistedMessages = await browserApi(
        clientPage,
        `/client-messages?clientId=${clientA}`,
      );
      assertStatus(persistedMessages, 200, 'read persisted portal message');
      expect(
        bodyAs<Array<{ body: string }>>(persistedMessages).some((item) => item.body === message),
      ).toBe(true);

      await login(secondClientPage, 'cliente.beta@example.test');
      await expect(secondClientPage.getByRole('heading', { name: /Minha/ })).toBeVisible();
      await expect(
        secondClientPage.getByRole('button', { name: new RegExp(secondClientTitle) }),
      ).toBeVisible();
      await expect(secondClientPage.getByText(visibleTitle, { exact: true })).toHaveCount(0);
      const secondClientCannotReadFirst = await browserApi(
        secondClientPage,
        `/documents/${visibleDocumentId}`,
      );
      assertAuthorizationDenial(secondClientCannotReadFirst, {
        status: 404,
        code: 'not_found',
        message: 'Documento não encontrado',
        label: 'second same-organization client cannot read first client document',
      });

      const firstOrganizationCannotReadSecond = await browserApi(
        adminPage,
        `/documents/${otherOrganizationDocumentId}`,
      );
      assertAuthorizationDenial(firstOrganizationCannotReadSecond, {
        status: 404,
        code: 'not_found',
        message: 'Documento não encontrado',
        label: 'first organization cannot read second organization document',
      });
      const secondOrganizationCannotReadFirst = await browserApi(
        otherOrganizationPage,
        `/documents/${visibleDocumentId}`,
        { organizationId: organizationB },
      );
      assertAuthorizationDenial(secondOrganizationCannotReadFirst, {
        status: 404,
        code: 'not_found',
        message: 'Documento não encontrado',
        label: 'second organization cannot read first organization document',
      });

      const downloadUrlResponsePromise = clientPage.waitForResponse((response) =>
        response.url().includes(`/v1/documents/${visibleDocumentId}/download-url`),
      );
      await clientPage.getByRole('button', { name: new RegExp(visibleTitle) }).click();
      const downloadUrlResponse = await downloadUrlResponsePromise;
      expect(downloadUrlResponse.status()).toBe(200);
      const signedUrl = ((await downloadUrlResponse.json()) as { url: string }).url;
      expect(new URL(signedUrl).hostname).toBe('127.0.0.1');
      const documentPage = await clientContext.newPage();
      const storageResponsePromise = documentPage.waitForResponse((response) => {
        const responseUrl = new URL(response.url());
        const requestedUrl = new URL(signedUrl);
        return (
          responseUrl.origin === requestedUrl.origin &&
          responseUrl.pathname === requestedUrl.pathname
        );
      });
      await documentPage.goto(signedUrl).catch((error: unknown) => {
        if (!(error instanceof Error) || !error.message.includes('Download is starting'))
          throw error;
      });
      const storageResponse = await storageResponsePromise;
      expect(storageResponse.status()).toBe(200);
      expect(storageResponse.headers()['content-type']).toContain('image/png');
      await documentPage.close();
    } finally {
      await adminContext.close();
      await clientContext.close();
      await secondClientContext.close();
      await otherOrganizationContext.close();
      await otherOrganizationClientContext.close();
    }
  }
});

test('perfis admin, advogado, financeiro, secretaria e cliente mantêm permissões e isolamento', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const scenarios = [
    {
      email: 'admin.aurora@example.test',
      allowed: [
        ['/admin/users', 200],
        ['/finance/expenses', 200],
      ],
      denied: [] as string[],
    },
    {
      email: 'advogado.aurora@example.test',
      allowed: [['/matters?page=1&pageSize=5', 200]],
      denied: ['/finance/expenses'],
    },
    {
      email: 'financeiro.aurora@example.test',
      allowed: [['/finance/expenses', 200]],
      denied: ['/admin/users'],
    },
    {
      email: 'secretaria.aurora@example.test',
      allowed: [['/clients?page=1&pageSize=5', 200]],
      denied: ['/finance/payments'],
    },
    {
      email: 'cliente.aurora@example.test',
      allowed: [['/documents?page=1&pageSize=5', 200]],
      denied: ['/clients?page=1&pageSize=5'],
    },
  ] as const;

  for (const viewport of formViewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    try {
      for (const scenario of scenarios) {
        await login(page, scenario.email);
        for (const [path, expectedStatus] of scenario.allowed) {
          const result = await browserApi(page, path);
          assertStatus(result, expectedStatus, `${scenario.email} ${path} at ${viewport.width}px`);
        }
        for (const path of scenario.denied) {
          const result = await browserApi(page, path);
          assertStatus(result, 403, `${scenario.email} denied ${path} at ${viewport.width}px`);
        }
        await page.evaluate(async () => {
          localStorage.clear();
        });
        await page.context().clearCookies();
        await page.goto('about:blank');
      }
    } finally {
      await context.close();
    }
  }
});
