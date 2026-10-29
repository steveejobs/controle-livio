import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001/v1';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const supabaseAuthCookieName = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
const localPassword = 'LocalOnly-ChangeMe-2026!';
const organizationA = '10000000-0000-4000-8000-000000000001';
const organizationB = '20000000-0000-4000-8000-000000000001';
const clientA = '11000000-0000-4000-8000-000000000001';
const matterA = '14000000-0000-4000-8000-000000000001';
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
  await page.screenshot({
    path: join(screenshots, `${name}.png`),
    fullPage: false,
    animations: 'disabled',
  });
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
      organizationId: organizationA,
      accessToken,
    },
  );
}

function pdfBytes(): number[] {
  const stream = 'BT /F1 12 Tf 20 70 Td (Synthetic local QA document) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let document = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(document);
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    document += `${String(offset).padStart(10, '0')} 00000 n \n`;
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return [...Buffer.from(document, 'ascii')];
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function dateIso(offsetDays: number) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString();
}

function dateInput(offsetDays = 0) {
  const value = new Date();
  value.setUTCDate(value.getUTCDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

function reportRange() {
  const from = new Date();
  from.setUTCDate(from.getUTCDate() - 2);
  from.setUTCHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 7);
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&groupBy=day`;
}

function assertStatus(result: BrowserResult, expected: number, label: string) {
  expect(result.status, `${label} returned HTTP ${result.status}`).toBe(expected);
}

function bodyAs<T>(result: BrowserResult): T {
  return result.body as T;
}

test('autenticação real, navegação, carregamento sob demanda e compartilhamento de membership', async ({
  page,
}) => {
  const traffic = createTrafficRecorder(page);
  let dashboardStartedAt = performance.now();
  let metricsSaved = false;
  const externalHosts = await enableLocalNetworkOnly(page.context());
  traffic.setPhase('setup');
  try {
    await login(page, 'admin.aurora@example.test', () => {
      traffic.setPhase('dashboard');
      dashboardStartedAt = performance.now();
    });
    await expect(page.getByRole('heading', { name: /Vis.o geral/ })).toBeVisible();
    await traffic.waitForQuiet();
    await screenshotEvidence(page, 'navigation-dashboard');
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
      await page
        .locator('#primary-navigation')
        .getByRole('button', { name: destination.nav })
        .click();
      await expect(
        page.getByRole('heading', { name: destination.heading, exact: true }),
      ).toBeVisible();
      await traffic.waitForQuiet();
      await screenshotEvidence(page, `navigation-${destination.phase}`);
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
    await screenshotEvidence(page, 'navigation-expenses');
    traffic.phase('expenses').perceivedLoadMs = Number(
      (performance.now() - expenseBegan).toFixed(2),
    );

    for (const destination of [
      { phase: 'documents', nav: 'Documentos', heading: 'Documentos' },
      { phase: 'tasks', nav: 'Tarefas', heading: 'Tarefas' },
    ]) {
      traffic.setPhase(destination.phase);
      const began = performance.now();
      await page
        .locator('#primary-navigation')
        .getByRole('button', { name: destination.nav })
        .click();
      await expect(
        page.getByRole('heading', { name: destination.heading, exact: true }),
      ).toBeVisible();
      await traffic.waitForQuiet();
      await screenshotEvidence(page, `navigation-${destination.phase}`);
      traffic.phase(destination.phase).perceivedLoadMs = Number(
        (performance.now() - began).toFixed(2),
      );
    }

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
    traffic.save(metrics);
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
      traffic.save({
        environment: 'GitHub-hosted Linux; local Supabase; no API mocks',
        partial: true,
        navigation: traffic.toJSON(),
      });
  }
});

test('navegação repetida em duas sessões e organizações distintas', async ({ browser }) => {
  const sessions = [
    { name: 'aurora', email: 'admin.aurora@example.test' },
    { name: 'horizonte', email: 'admin.horizonte@example.test' },
  ] as const;
  const contexts = await Promise.all(sessions.map(() => browser.newContext()));
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
        if (route.nav) {
          await page
            .locator('#primary-navigation')
            .getByRole('button', { name: route.nav })
            .click();
        }
        await expect(page.getByRole('heading', { name: route.heading, exact: true })).toBeVisible();
        await recorder.waitForQuiet();
        recorder.phase(phase).perceivedLoadMs = Number((performance.now() - startedAt).toFixed(2));
        await screenshotEvidence(page, `two-session-${sessionName}-${route.phase}`);
        expect(recorder.phase(phase).httpErrors).toEqual([]);
      }
    }

    for (const [index, page] of pages.entries()) {
      const sessionName = sessions[index]!.name;
      const recorder = traffic[index]!;
      const phase = `${sessionName}:expenses`;
      recorder.setPhase('setup');
      await page.locator('#primary-navigation').getByRole('button', { name: /Receb/ }).click();
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
      await screenshotEvidence(page, `two-session-${sessionName}-expenses`);
    }

    expect(traffic.map((recorder) => recorder.pending())).toEqual([0, 0]);
    expect(externalHosts.map((hosts) => [...hosts])).toEqual([[], []]);
    traffic[0]!.save(
      {
        environment: 'two local Auth sessions; organizations Aurora and Horizonte; no API mocks',
        sessions: Object.fromEntries(
          sessions.map((session, index) => [session.name, traffic[index]!.toJSON()]),
        ),
      },
      'two-session-navigation-metrics.json',
    );
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('jornada 1: cliente, processo, responsável e atualização de status', async ({ page }) => {
  await login(page, 'admin.aurora@example.test');
  const suffix = randomUUID().slice(0, 8);
  const clientName = `Cliente QA ${suffix}`;
  await page.locator('#primary-navigation').getByRole('button', { name: 'Clientes' }).click();
  await page.getByRole('button', { name: 'Novo cliente', exact: true }).click();
  await page.getByLabel('Nome completo', { exact: true }).fill(clientName);
  await page.getByLabel('E-mail', { exact: true }).fill('cliente-' + suffix + '@example.test');
  const clientResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/v1/clients' && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Cadastrar e abrir cliente' }).click();
  const client = await clientResponse;
  expect(client.status()).toBe(201);
  expect(client.request().postDataJSON()).toMatchObject({
    type: 'PERSON',
    displayName: clientName,
  });
  const createdClient = (await client.json()) as { id: string; displayName: string };
  expect(createdClient.displayName).toBe(clientName);
  await expect(page.getByText(clientName, { exact: true }).first()).toBeVisible();

  const reference = `QA-${suffix}`;
  const matter = await browserApi(page, '/matters', {
    method: 'POST',
    body: {
      clientId: createdClient.id,
      pipelineId: '12000000-0000-4000-8000-000000000001',
      currentStageId: '13000000-0000-4000-8000-000000000001',
      responsibleLawyerId: lawyerUserA,
      reference,
      title: `Processo QA ${suffix}`,
      status: 'ACTIVE',
      priority: 'MEDIUM',
    },
  });
  assertStatus(matter, 201, 'create matter');
  const createdMatter = bodyAs<{ id: string; responsibleLawyerId: string }>(matter);
  expect(createdMatter.responsibleLawyerId).toBe(lawyerUserA);

  const updated = await browserApi(page, `/matters/${createdMatter.id}`, {
    method: 'PATCH',
    body: { status: 'SUSPENDED' },
  });
  assertStatus(updated, 200, 'update matter status');
  const persisted = await browserApi(page, `/matters/${createdMatter.id}`);
  assertStatus(persisted, 200, 'read persisted matter');
  expect(bodyAs<{ status: string; responsibleLawyerId: string }>(persisted)).toMatchObject({
    status: 'SUSPENDED',
    responsibleLawyerId: lawyerUserA,
  });

  await page.reload();
  await page.locator('#primary-navigation').getByRole('button', { name: 'Clientes' }).click();
  await expect(page.getByText(clientName, { exact: true })).toBeVisible();
  await page.locator('#primary-navigation').getByRole('button', { name: 'Processos' }).click();
  await expect(page.getByText(reference, { exact: true })).toBeVisible();
  await screenshotEvidence(page, 'journey-client-matter');
});

test('jornada 2: contrato, recebível, pagamento confirmado e relatório', async ({ page }) => {
  await login(page, 'admin.aurora@example.test');
  const suffix = randomUUID().slice(0, 8);
  const contract = await browserApi(page, '/finance/contracts', {
    method: 'POST',
    body: {
      clientId: clientA,
      matterId: matterA,
      number: `QA-CT-${suffix}`,
      title: `Contrato QA ${suffix}`,
      feeModel: 'FIXED',
      fixedAmount: '137.50',
      serviceNames: ['Consultoria sintética'],
    },
  });
  assertStatus(contract, 201, 'create contract');
  const createdContract = bodyAs<{ id: string }>(contract);

  const issueDate = todayIso();
  const dueDate = dateIso(14);
  const reference = `QA-REC-${suffix}`;
  const receivable = await browserApi(page, '/finance/receivables', {
    method: 'POST',
    body: {
      clientId: clientA,
      matterId: matterA,
      contractId: createdContract.id,
      reference,
      description: `Recebível sintético ${suffix}`,
      originalAmount: '137.50',
      issueDate,
      installments: [{ sequence: 1, amount: '137.50', dueDate }],
    },
  });
  assertStatus(receivable, 201, 'create receivable');
  const createdReceivable = bodyAs<{ installments: Array<{ id: string }> }>(receivable);
  expect(createdReceivable.installments).toHaveLength(1);

  const paymentReference = `QA-PG-${suffix}`;
  let idempotencyKey: string | undefined;
  page.on('request', (request) => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/v1/finance/payments') {
      idempotencyKey = request.headers()['idempotency-key'];
    }
  });
  await page.reload();
  await page.locator('#primary-navigation').getByRole('button', { name: /Receb/ }).click();
  await page.getByRole('button', { name: 'Receber pagamento' }).click();
  const paymentForm = page.locator('form').filter({
    has: page.getByRole('button', { name: 'Confirmar pagamento' }),
  });
  await paymentForm.getByRole('combobox').nth(0).selectOption(clientA);
  const receivableOption = paymentForm
    .getByLabel('Parcela')
    .locator('option')
    .filter({ hasText: reference });
  await expect(receivableOption).toHaveCount(1);
  const installmentOption = await receivableOption.getAttribute('value');
  if (!installmentOption) throw new Error('A parcela do recebível não foi carregada.');
  expect(installmentOption).toBe(createdReceivable.installments[0]!.id);
  await paymentForm.getByRole('combobox').nth(1).selectOption(installmentOption);
  await paymentForm.getByLabel('Referência do pagamento').fill(paymentReference);
  await paymentForm.getByLabel('Valor recebido').fill('137,50');
  await paymentForm.getByLabel('Data do pagamento').fill(new Date().toISOString().slice(0, 16));
  await paymentForm.getByRole('button', { name: 'Confirmar pagamento' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Pagamento confirmado' })).toBeVisible();
  expect(idempotencyKey).toBeTruthy();

  const payments = await browserApi(page, '/finance/payments?page=1&pageSize=100');
  assertStatus(payments, 200, 'read persisted payment');
  const persistedPayment = bodyAs<{
    items: Array<{ reference: string; amount: string; status: string }>;
  }>(payments).items.find((item) => item.reference === paymentReference);
  expect(persistedPayment).toMatchObject({ reference: paymentReference, status: 'CONFIRMED' });
  expect(Number(persistedPayment?.amount)).toBe(137.5);
  const received = await browserApi(page, `/reports/received?${reportRange()}`);
  assertStatus(received, 200, 'read received report');
  const reportRows = bodyAs<{ rows: Array<{ amount: string }> }>(received).rows;
  expect(reportRows.some((row) => Number(row.amount) >= 137.5)).toBe(true);

  await page.reload();
  await page.locator('#primary-navigation').getByRole('button', { name: /Receb/ }).click();
  await expect(page.getByText(reference, { exact: true })).toBeVisible();
  await page
    .getByRole('heading', { name: 'Pagamentos recebidos', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(page.getByText(paymentReference, { exact: true })).toBeVisible();
  await page.locator('#primary-navigation').getByRole('button', { name: 'Relatórios' }).click();
  await expect(page.getByRole('heading', { name: 'Relatórios', exact: true })).toBeVisible();
  await page.locator('.report-filters').getByRole('combobox').nth(0).selectOption('received');
  await expect(page.locator('tbody')).toContainText('137,50');
  await screenshotEvidence(page, 'journey-contract-receivable-payment');
});

test('jornada 3: despesa, aprovação independente, pagamento e fluxo de caixa', async ({
  browser,
}) => {
  const financeContext = await browser.newContext();
  const adminContext = await browser.newContext();
  const financePage = await financeContext.newPage();
  const adminPage = await adminContext.newPage();
  try {
    await login(financePage, 'financeiro.aurora@example.test');
    const suffix = randomUUID().slice(0, 8);
    const description = `Despesa QA ${suffix}`;
    await financePage.locator('#primary-navigation').getByRole('button', { name: /Receb/ }).click();
    await financePage.getByRole('button', { name: 'Nova despesa' }).click();
    const expenseForm = financePage.locator('form').filter({
      has: financePage.getByRole('button', { name: 'Cadastrar despesa' }),
    });
    await expenseForm.getByLabel('Cliente').selectOption(clientA);
    await expenseForm.getByLabel('Processo').selectOption(matterA);
    await expenseForm.getByLabel('Responsável').selectOption(financeUserA);
    await expenseForm.getByLabel('Categoria').fill('QA sintético');
    await expenseForm.getByLabel('Detalhes da despesa').fill(description);
    await expenseForm.getByLabel('Valor').fill('42,25');
    await expenseForm.getByLabel('Data da despesa').fill(dateInput());
    await expenseForm.getByLabel('Vencimento').fill(dateInput(10));
    await expenseForm.getByRole('button', { name: 'Cadastrar despesa' }).click();
    await expect(
      financePage.getByRole('status').filter({ hasText: 'Despesa cadastrada.' }),
    ).toBeVisible();
    await pageExpenseSection(financePage);
    let expenseRow = financePage.getByRole('row').filter({ hasText: description });
    await expect(expenseRow).toContainText('Rascunho');
    await expenseRow.getByRole('button', { name: 'Enviar para aprovação' }).click();
    await expect(
      financePage.getByRole('status').filter({ hasText: 'Despesa enviada para aprovação.' }),
    ).toBeVisible();
    await expect(expenseRow).toContainText('Aguardando aprovação');

    await login(adminPage, 'admin.aurora@example.test');
    await adminPage.locator('#primary-navigation').getByRole('button', { name: /Receb/ }).click();
    await pageExpenseSection(adminPage);
    expenseRow = adminPage.getByRole('row').filter({ hasText: description });
    await expect(expenseRow).toContainText('Aguardando aprovação');
    await expenseRow.getByRole('button', { name: 'Aprovar' }).click();
    await expect(
      adminPage.getByRole('status').filter({ hasText: 'Despesa aprovada.' }),
    ).toBeVisible();
    await expect(expenseRow).toContainText('Aguardando pagamento');
    await expenseRow.getByRole('button', { name: 'Registrar pagamento' }).click();
    await adminPage.getByLabel('Valor integral').fill('42,25');
    await adminPage.getByLabel('Data do pagamento').fill(dateInput());
    await adminPage.getByLabel('Forma de pagamento').fill('PIX');
    await adminPage.getByLabel('Referência').fill(`QA-${suffix}`);
    await adminPage.getByRole('button', { name: 'Confirmar quitação integral' }).click();
    await expect(
      adminPage.getByRole('status').filter({ hasText: 'Pagamento integral registrado no caixa.' }),
    ).toBeVisible();
    await expect(expenseRow).toContainText('Paga');

    const persistedExpenses = await browserApi(adminPage, '/finance/expenses?page=1&pageSize=100');
    assertStatus(persistedExpenses, 200, 'read persisted paid expense');
    const persistedExpense = bodyAs<{
      items: Array<{ description: string; status: string; amount: string }>;
    }>(persistedExpenses).items.find((item) => item.description === description);
    expect(persistedExpense).toMatchObject({
      description,
      status: 'PAID',
      amount: '42.25',
    });

    const cashFlow = await browserApi(adminPage, `/reports/cash-flow?${reportRange()}`);
    assertStatus(cashFlow, 200, 'read cash flow');
    const rows = bodyAs<{ rows: Array<{ paid_expenses: string }> }>(cashFlow).rows;
    expect(rows.some((row) => Number(row.paid_expenses) >= 42.25)).toBe(true);

    await adminPage.reload();
    await adminPage.locator('#primary-navigation').getByRole('button', { name: /Receb/ }).click();
    await pageExpenseSection(adminPage);
    const paidExpenseRow = adminPage.getByRole('row').filter({ hasText: description });
    await expect(paidExpenseRow).toContainText('Paga');
    await screenshotEvidence(adminPage, 'journey-expense-paid');
    await adminPage
      .locator('#primary-navigation')
      .getByRole('button', { name: 'Relatórios' })
      .click();
    await expect(adminPage.getByRole('heading', { name: 'Relatórios', exact: true })).toBeVisible();
    await adminPage
      .locator('.report-filters')
      .getByRole('combobox')
      .nth(0)
      .selectOption('cash-flow');
    await expect(adminPage.locator('tbody')).toContainText('42,25');
    await screenshotEvidence(adminPage, 'journey-expense-cash-flow');
  } finally {
    await financeContext.close();
    await adminContext.close();
  }
});

async function pageExpenseSection(page: Page) {
  await page.getByRole('heading', { name: 'Despesas', exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByRole('heading', { name: 'Despesas', exact: true })).toBeVisible();
}

test('jornada 4: upload, download protegido e assinatura eletrônica no navegador', async ({
  page,
}) => {
  await login(page, 'admin.aurora@example.test');
  const suffix = randomUUID().slice(0, 8);
  const title = `PDF de assinatura QA ${suffix}`;
  const upload = await browserUpload(
    page,
    { title, category: 'QA', visibility: 'CLIENT', clientId: clientA },
    `qa-${suffix}.pdf`,
    'application/pdf',
    pdfBytes(),
  );
  assertStatus(upload, 201, 'upload PDF to local Storage');
  const documentId = bodyAs<{ id: string }>(upload).id;

  const download = await browserApi(page, `/documents/${documentId}/download-url`);
  assertStatus(download, 200, 'create protected download URL');
  const downloadUrl = bodyAs<{ url: string }>(download).url;
  expect(new URL(downloadUrl).hostname).toBe('127.0.0.1');
  const documentPage = await page.context().newPage();
  const downloadPromise = documentPage.waitForEvent('download');
  const downloadResponsePromise = documentPage.waitForResponse((response) => {
    const responseUrl = new URL(response.url());
    const requestedUrl = new URL(downloadUrl);
    return (
      responseUrl.origin === requestedUrl.origin && responseUrl.pathname === requestedUrl.pathname
    );
  });
  await documentPage.goto(downloadUrl).catch((error: unknown) => {
    if (!(error instanceof Error) || !error.message.includes('Download is starting')) throw error;
  });
  const [downloadedFile, downloadResponse] = await Promise.all([
    downloadPromise,
    downloadResponsePromise,
  ]);
  expect(downloadResponse.status()).toBe(200);
  expect(downloadResponse.headers()['content-type']).toContain('application/pdf');
  const downloadedPath = await downloadedFile.path();
  if (!downloadedPath) throw new Error('O download do PDF sintético não foi salvo.');
  expect(readFileSync(downloadedPath).subarray(0, 8).toString('ascii')).toContain('%PDF-');
  await documentPage.close();

  const requested = await browserApi(page, `/documents/${documentId}/signature-requests`, {
    method: 'POST',
    body: { signerName: 'Cliente Ficticio Alfa', expiresInDays: 2 },
  });
  assertStatus(requested, 201, 'create signature request');
  const signing = bodyAs<{ token: string; documentTitle: string }>(requested);
  expect(signing.documentTitle).toBe(title);

  await page.goto(`/assinar/${signing.token}`);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Usar nome digitado' }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Assinar documento' }).click();
  await expect(page.getByRole('heading', { name: /Assinatura conclu.da/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await screenshotEvidence(page, 'journey-document-signed');
});

test('jornada 5: tarefa atribuída a advogado e concluída', async ({ page }) => {
  await login(page, 'admin.aurora@example.test');
  const suffix = randomUUID().slice(0, 8);
  const title = `Tarefa QA ${suffix}`;
  await page.locator('#primary-navigation').getByRole('button', { name: 'Tarefas' }).click();
  await page.getByRole('button', { name: 'Nova tarefa' }).click();
  await page.getByLabel('O que precisa ser feito').fill(title);
  await page.getByLabel('Prioridade', { exact: true }).selectOption('HIGH');
  await expect(page.getByLabel('Responsável', { exact: true })).toBeEnabled();
  await page.getByLabel('Responsável', { exact: true }).selectOption(lawyerUserA);
  const taskResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/v1/tasks' && response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Criar tarefa', exact: true }).click();
  const created = await taskResponse;
  expect(created.status()).toBe(201);
  expect(created.request().postDataJSON()).toMatchObject({
    title,
    assigneeId: lawyerUserA,
    priority: 'HIGH',
  });
  const taskId = ((await created.json()) as { id: string }).id;
  await expect(page.getByRole('status')).toContainText('Tarefa criada.');
  await page.getByLabel('Status de ' + title).selectOption('COMPLETED');
  await expect(page.getByRole('status')).toContainText('Tarefa atualizada.');
  const persisted = await browserApi(page, '/tasks');
  assertStatus(persisted, 200, 'read persisted tasks');
  expect(
    bodyAs<Array<{ id: string; status: string }>>(persisted).find((task) => task.id === taskId)
      ?.status,
  ).toBe('COMPLETED');

  await page.reload();
  await page.locator('#primary-navigation').getByRole('button', { name: 'Tarefas' }).click();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expect(page.getByLabel(`Status de ${title}`)).toHaveValue('COMPLETED');
  await screenshotEvidence(page, 'journey-task-completed');
});

test('jornada 6: portal, documento privado por cliente, mensagem persistida e isolamento', async ({
  browser,
}) => {
  const adminContext = await browser.newContext();
  const clientContext = await browser.newContext();
  const adminPage = await adminContext.newPage();
  const clientPage = await clientContext.newPage();
  try {
    await login(adminPage, 'admin.aurora@example.test');
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

    await login(clientPage, 'cliente.aurora@example.test');
    await expect(clientPage.getByRole('heading', { name: /Minha/ })).toBeVisible();
    await expect(clientPage.getByRole('button', { name: new RegExp(visibleTitle) })).toBeVisible();
    await expect(clientPage.getByText(internalTitle, { exact: true })).toHaveCount(0);
    await screenshotEvidence(clientPage, 'journey-client-portal');

    const forbiddenInternal = await browserApi(clientPage, `/documents/${internalId}`);
    assertStatus(forbiddenInternal, 404, 'client cannot read internal document');
    const crossOrganization = await browserApi(clientPage, '/clients?page=1&pageSize=5', {
      organizationId: organizationB,
    });
    assertStatus(crossOrganization, 401, 'client cannot select another organization');

    const message = `Mensagem sintética QA ${suffix}`;
    await clientPage.getByLabel(/Responder ao escrit/).fill(message);
    await clientPage.getByRole('button', { name: 'Enviar mensagem' }).click();
    await expect(clientPage.getByRole('status')).toContainText('Mensagem enviada');
    await expect(clientPage.getByText(message, { exact: true })).toBeVisible();
    const persistedMessages = await browserApi(clientPage, `/client-messages?clientId=${clientA}`);
    assertStatus(persistedMessages, 200, 'read persisted portal message');
    expect(
      bodyAs<Array<{ body: string }>>(persistedMessages).some((item) => item.body === message),
    ).toBe(true);

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
        responseUrl.origin === requestedUrl.origin && responseUrl.pathname === requestedUrl.pathname
      );
    });
    await documentPage.goto(signedUrl).catch((error: unknown) => {
      if (!(error instanceof Error) || !error.message.includes('Download is starting')) throw error;
    });
    const storageResponse = await storageResponsePromise;
    expect(storageResponse.status()).toBe(200);
    expect(storageResponse.headers()['content-type']).toContain('image/png');
    await documentPage.close();
  } finally {
    await adminContext.close();
    await clientContext.close();
  }
});

test('perfis admin, advogado, financeiro, secretaria e cliente mantêm permissões e isolamento', async ({
  browser,
}) => {
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

  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    for (const scenario of scenarios) {
      await login(page, scenario.email);
      for (const [path, expectedStatus] of scenario.allowed) {
        const result = await browserApi(page, path);
        assertStatus(result, expectedStatus, `${scenario.email} ${path}`);
      }
      for (const path of scenario.denied) {
        const result = await browserApi(page, path);
        assertStatus(result, 403, `${scenario.email} denied ${path}`);
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
});
