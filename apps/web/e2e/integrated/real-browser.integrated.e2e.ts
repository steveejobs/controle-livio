import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test';
import { addMonths, formatDate } from '../../features/shared/format';

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001/v1';
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const supabaseAuthCookieName = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`;
const localPassword = 'LocalOnly-ChangeMe-2026!';
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

function amountUnits(value: string): bigint {
  const normalized = value.trim().replace(',', '.');
  const [whole, fraction = ''] = normalized.split('.');
  if (!/^\d+(\.\d{1,4})?$/.test(normalized)) throw new Error(`Invalid decimal: ${value}`);
  return BigInt(whole!) * 10_000n + BigInt(fraction.padEnd(4, '0'));
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

test('jornada 1: cliente, processo, responsável e atualização de status', async ({ browser }) => {
  test.setTimeout(240_000);
  for (const viewport of formViewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    try {
      await login(page, 'admin.aurora@example.test');
      const suffix = randomUUID().slice(0, 8);
      const clientName = `Cliente QA ${suffix}`;
      await page.locator('#primary-navigation').getByRole('button', { name: 'Clientes' }).click();
      await page.getByRole('button', { name: 'Novo cliente', exact: true }).click();
      await page.getByLabel('Nome completo', { exact: true }).fill(clientName);
      await page.getByLabel('E-mail', { exact: true }).fill('cliente-' + suffix + '@example.test');
      const clientResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/v1/clients' &&
          response.request().method() === 'POST',
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
      const matterTitle = `Processo QA ${suffix}`;
      await page.locator('#primary-navigation').getByRole('button', { name: 'Processos' }).click();
      await page.getByRole('button', { name: 'Novo processo', exact: true }).click();
      const matterForm = page.locator('form').filter({
        has: page.getByRole('button', { name: 'Cadastrar processo', exact: true }),
      });
      await matterForm.getByLabel('Cliente').selectOption(createdClient.id);
      await matterForm
        .getByLabel('Fluxo de atendimento')
        .selectOption('12000000-0000-4000-8000-000000000001');
      await matterForm.getByLabel('Referência interna do processo').fill(reference);
      await matterForm.getByLabel('Nome do processo').fill(matterTitle);
      await expect(matterForm.getByLabel('Advogado responsável (opcional)')).toContainText(
        'Advogado Aurora',
      );
      await matterForm.getByLabel('Advogado responsável (opcional)').selectOption(lawyerUserA);
      const matterResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/v1/matters' &&
          response.request().method() === 'POST',
      );
      await matterForm.getByRole('button', { name: 'Cadastrar processo' }).click();
      const matter = await matterResponse;
      expect(matter.status()).toBe(201);
      expect(matter.request().postDataJSON()).toMatchObject({
        clientId: createdClient.id,
        pipelineId: '12000000-0000-4000-8000-000000000001',
        responsibleLawyerId: lawyerUserA,
        reference,
        title: matterTitle,
      });
      const createdMatter = (await matter.json()) as { id: string };
      await expect(page.getByRole('status')).toContainText('Processo cadastrado.');

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

      await page.reload();
      await page.locator('#primary-navigation').getByRole('button', { name: 'Processos' }).click();
      await expect(page.getByText(reference, { exact: true })).toBeVisible();
      await expect(page.getByText('Advogado Aurora', { exact: true })).toBeVisible();

      await page.getByRole('button', { name: 'Novo processo', exact: true }).click();
      const duplicateForm = page.locator('form').filter({
        has: page.getByRole('button', { name: 'Cadastrar processo', exact: true }),
      });
      await duplicateForm.getByLabel('Cliente').selectOption(createdClient.id);
      await duplicateForm
        .getByLabel('Fluxo de atendimento')
        .selectOption('12000000-0000-4000-8000-000000000001');
      await duplicateForm.getByLabel('Referência interna do processo').fill(reference);
      await duplicateForm.getByLabel('Nome do processo').fill(`Duplicado ${matterTitle}`);
      await duplicateForm.getByLabel('Advogado responsável (opcional)').selectOption(lawyerUserA);
      await duplicateForm.getByRole('button', { name: 'Cadastrar processo' }).click();
      await expect(page.getByRole('status')).toContainText('Erro:');
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
      await login(page, 'admin.aurora@example.test');
      const suffix = randomUUID().slice(0, 8);
      const contractNumber = `QA-CT-${suffix}`;
      const contractTitle = `Contrato QA ${suffix}`;

      await page.locator('#primary-navigation').getByRole('button', { name: 'Contratos' }).click();
      await page.getByRole('button', { name: 'Novo contrato', exact: true }).click();
      const contractForm = page.locator('form').filter({
        has: page.getByRole('button', { name: 'Cadastrar contrato', exact: true }),
      });
      await contractForm.getByLabel('Cliente').selectOption(clientA);
      await contractForm.getByLabel('Número do contrato').fill(contractNumber);
      await contractForm.getByLabel('Nome do contrato').fill(contractTitle);
      await contractForm.getByLabel('Modelo de honorários').selectOption('FIXED');
      await contractForm.getByLabel('Valor fixo (R$)').fill('100,00');
      const contractResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/v1/finance/contracts' &&
          response.request().method() === 'POST',
      );
      await contractForm.getByRole('button', { name: 'Cadastrar contrato' }).click();
      const contractCreated = await contractResponse;
      expect(contractCreated.status()).toBe(201);
      expect(contractCreated.request().postDataJSON()).toMatchObject({
        clientId: clientA,
        number: contractNumber,
        title: contractTitle,
        feeModel: 'FIXED',
        fixedAmount: '100.00',
      });
      const contract = (await contractCreated.json()) as { id: string; fixedAmount: string };
      expect(amountUnits(contract.fixedAmount)).toBe(amountUnits('100.00'));
      await expect(page.getByRole('status')).toContainText('Contrato cadastrado.');
      await expect(page.getByRole('row').filter({ hasText: contractNumber })).toBeVisible();

      const persistedContracts = await browserApi(page, '/finance/contracts?page=1&pageSize=100');
      assertStatus(persistedContracts, 200, 'read contract persisted from form');
      const persistedContract = bodyAs<{
        items: Array<{ id: string; clientId: string; number: string; fixedAmount: string }>;
      }>(persistedContracts).items.find((item) => item.id === contract.id);
      expect(persistedContract).toMatchObject({
        id: contract.id,
        clientId: clientA,
        number: contractNumber,
      });
      expect(amountUnits(persistedContract!.fixedAmount)).toBe(amountUnits('100.00'));

      const reference = `QA-REC-${suffix}`;
      const issueDate = dateInput();
      const firstDueDate = dateInput(14);
      await page.locator('#primary-navigation').getByRole('button', { name: /Receb/ }).click();
      const receivableForm = page.locator('form').filter({
        has: page.getByRole('button', { name: 'Criar cobrança e parcelas' }),
      });
      await receivableForm.getByLabel('Cliente').selectOption(clientA);
      await receivableForm.getByLabel('Contrato associado (opcional)').selectOption(contract.id);
      await receivableForm.getByLabel('Código da cobrança').fill(reference);
      await receivableForm.getByLabel('Serviço ou motivo da cobrança').fill(`Honorários ${suffix}`);
      await receivableForm.getByLabel('Valor total').fill('100,00');
      await receivableForm.getByLabel('Parcelas após entrada').fill('3');
      await receivableForm.getByLabel('Data de emissão').fill(issueDate);
      await receivableForm.getByLabel('Primeiro vencimento').fill(firstDueDate);
      const receivableResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/v1/finance/receivables' &&
          response.request().method() === 'POST',
      );
      await receivableForm.getByRole('button', { name: 'Criar cobrança e parcelas' }).click();
      const receivableCreated = await receivableResponse;
      expect(receivableCreated.status()).toBe(201);
      const receivablePayload = receivableCreated.request().postDataJSON() as {
        contractId: string;
        originalAmount: string;
        issueDate: string;
        installments: Array<{ sequence: number; amount: string; dueDate: string }>;
      };
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
      await expect(page.getByRole('status')).toContainText('Recebível e parcelas cadastrados.');

      const persistedReceivables = await browserApi(
        page,
        `/finance/receivables?page=1&pageSize=100&clientId=${clientA}&contractId=${contract.id}`,
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

      const receivableRow = page.getByRole('row').filter({ hasText: reference });
      await receivableRow.scrollIntoViewIfNeeded();
      await expect(receivableRow).toContainText('Saldo em aberto: R$ 100,00');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.getByRole('button', { name: 'Receber pagamento' }).click();
      const paymentForm = page.locator('form').filter({
        has: page.getByRole('button', { name: 'Confirmar pagamento' }),
      });
      await paymentForm.getByRole('combobox').nth(0).selectOption(clientA);

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
        const responsePromise = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname === '/v1/finance/payments' &&
            response.request().method() === 'POST',
        );
        await paymentForm.getByRole('button', { name: 'Confirmar pagamento' }).click();
        return responsePromise;
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
      await expect(page.getByRole('status')).toContainText('Erro:');
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
      await expect(page.getByRole('status')).toContainText('Pagamento confirmado');
      await expect(
        page
          .getByLabel('Parcela')
          .locator('option')
          .filter({
            hasText: `${reference} · parcela 1`,
          }),
      ).toContainText('R$ 23,34 em aberto');

      const duplicatePayment = await submitPayment(firstInstallment.id, '10,00', retryReference);
      expect(duplicatePayment.status()).toBe(409);
      await expect(page.getByRole('status')).toContainText('Erro:');
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
      await expect(page.getByRole('status')).toContainText('Erro:');
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
      const secondInstallment = createdReceivable.installments[1]!;
      const secondPaid = await submitPayment(secondInstallment.id, '33,33', `QA-PG-2-${suffix}`);
      expect(secondPaid.status()).toBe(201);
      const thirdInstallment = createdReceivable.installments[2]!;
      const thirdPaid = await submitPayment(thirdInstallment.id, '33,33', `QA-PG-3-${suffix}`);
      expect(thirdPaid.status()).toBe(201);

      const finalReceivables = await browserApi(
        page,
        `/finance/receivables?page=1&pageSize=100&clientId=${clientA}&contractId=${contract.id}`,
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

      await page.reload();
      await page.locator('#primary-navigation').getByRole('button', { name: /Receb/ }).click();
      const completedRow = page.getByRole('row').filter({ hasText: reference });
      await completedRow.scrollIntoViewIfNeeded();
      await expect(completedRow).toContainText('Saldo em aberto: R$ 0,00');
      await expect(completedRow).toContainText('PAID');
      await expect(completedRow).toContainText(formatDate(dueDates.at(-1)));
      await page.getByRole('button', { name: 'Receber pagamento' }).click();
      await paymentForm.getByRole('combobox').nth(0).selectOption(clientA);
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
      const suffix = randomUUID().slice(0, 8);
      const description = `Despesa QA ${suffix}`;
      await financePage
        .locator('#primary-navigation')
        .getByRole('button', { name: /Receb/ })
        .click();
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
        adminPage
          .getByRole('status')
          .filter({ hasText: 'Pagamento integral registrado no caixa.' }),
      ).toBeVisible();
      await expect(expenseRow).toContainText('Paga');

      const persistedExpenses = await browserApi(
        adminPage,
        '/finance/expenses?page=1&pageSize=100',
      );
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
      await screenshotEvidence(adminPage, `journey-expense-paid-${viewport.width}`);
      await adminPage
        .locator('#primary-navigation')
        .getByRole('button', { name: 'Relatórios' })
        .click();
      await expect(
        adminPage.getByRole('heading', { name: 'Relatórios', exact: true }),
      ).toBeVisible();
      await adminPage
        .locator('.report-filters')
        .getByRole('combobox')
        .nth(0)
        .selectOption('cash-flow');
      await expect(adminPage.locator('tbody')).toContainText('42,25');
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

test('jornada 4: upload, download protegido e assinatura eletrônica no navegador', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  for (const viewport of formViewports) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    try {
      await login(page, 'admin.aurora@example.test');
      const suffix = randomUUID().slice(0, 8);
      const title = `PDF de assinatura QA ${suffix}`;
      await page.locator('#primary-navigation').getByRole('button', { name: 'Documentos' }).click();
      await page.getByRole('button', { name: 'Enviar documento', exact: true }).click();
      const uploadForm = page.locator('form').filter({ has: page.getByLabel('Nome do documento') });
      await uploadForm.getByLabel('Nome do documento').fill(title);
      await uploadForm.getByLabel('Tipo de documento (opcional)').fill('QA');
      await uploadForm.getByLabel('Visibilidade').selectOption('CLIENT');
      await uploadForm.getByLabel('Cliente').selectOption(clientA);
      await uploadForm.getByLabel('Arquivo').setInputFiles({
        name: `qa-${suffix}.pdf`,
        mimeType: 'application/pdf',
        buffer: Buffer.from(pdfBytes()),
      });
      const uploadResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/v1/documents' &&
          response.request().method() === 'POST',
      );
      await uploadForm.getByRole('button', { name: 'Enviar documento' }).click();
      const uploaded = await uploadResponse;
      expect(uploaded.status()).toBe(201);
      const uploadFields = uploaded.request().postDataBuffer()?.toString('latin1') ?? '';
      expect(uploadFields).toContain(title);
      expect(uploadFields).toContain('visibility');
      await expect(page.getByRole('status')).toContainText('Documento enviado com segurança.');
      const documentId = ((await uploaded.json()) as { id: string }).id;
      const documentRow = page.getByRole('row').filter({ hasText: title });
      await expect(documentRow).toBeVisible();
      await expect(documentRow).toContainText('Cliente');

      const persistedDocuments = await browserApi(page, '/documents?page=1&pageSize=100');
      assertStatus(persistedDocuments, 200, 'read uploaded document metadata');
      expect(
        bodyAs<{
          items: Array<{ id: string; title: string; clientId: string; visibility: string }>;
        }>(persistedDocuments).items.find((item) => item.id === documentId),
      ).toMatchObject({ id: documentId, title, clientId: clientA, visibility: 'CLIENT' });

      const signedUrlResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/v1/documents/${documentId}/download-url`,
      );
      const storageResponsePromise = page
        .context()
        .waitForEvent('response', (response) =>
          new URL(response.url()).pathname.startsWith('/storage/v1/object/sign/legal-documents/'),
        );
      const popupPromise = page.waitForEvent('popup');
      await documentRow.getByRole('button', { name: 'Abrir' }).click();
      const [signedUrl, documentPage] = await Promise.all([signedUrlResponse, popupPromise]);
      expect(signedUrl.status()).toBe(200);
      const downloadUrl = ((await signedUrl.json()) as { url: string }).url;
      expect(new URL(downloadUrl).hostname).toBe('127.0.0.1');
      const downloadResponse = await storageResponsePromise;
      expect(new URL(downloadResponse.url()).pathname).toBe(new URL(downloadUrl).pathname);
      expect(downloadResponse.status()).toBe(200);
      expect(downloadResponse.headers()['content-type']).toContain('application/pdf');
      expect(downloadResponse.body()).resolves.toHaveLength(pdfBytes().length);
      await documentPage.close();

      await documentRow.getByRole('button', { name: 'Solicitar assinatura' }).click();
      const requestDialog = page.getByRole('dialog', { name: 'Enviar para assinatura' });
      await requestDialog.getByLabel('Nome de quem assinará').fill('Cliente Ficticio Alfa');
      await requestDialog.getByLabel('Validade do link').selectOption('3');
      const signingResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === `/v1/documents/${documentId}/signature-requests` &&
          response.request().method() === 'POST',
      );
      await requestDialog.getByRole('button', { name: 'Criar link de assinatura' }).click();
      const requested = await signingResponse;
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
      await shareDialog.getByRole('button', { name: 'Fechar' }).click();

      const invalidTitle = `Arquivo inválido QA ${suffix}`;
      await page.getByRole('button', { name: 'Enviar documento', exact: true }).click();
      const invalidForm = page
        .locator('form')
        .filter({ has: page.getByLabel('Nome do documento') });
      await invalidForm.getByLabel('Nome do documento').fill(invalidTitle);
      await invalidForm.getByLabel('Visibilidade').selectOption('INTERNAL');
      await invalidForm.getByLabel('Arquivo').setInputFiles({
        name: `invalid-${suffix}.pdf`,
        mimeType: 'application/pdf',
        buffer: Buffer.from('not a PDF document'),
      });
      const invalidUpload = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/v1/documents' &&
          response.request().method() === 'POST',
      );
      await invalidForm.getByRole('button', { name: 'Enviar documento' }).click();
      expect((await invalidUpload).status()).toBe(400);
      await expect(page.getByRole('status')).toContainText('Erro:');
      await expect(page.getByRole('row').filter({ hasText: invalidTitle })).toHaveCount(0);

      const oversizedTitle = `Arquivo grande QA ${suffix}`;
      await page.getByRole('button', { name: 'Enviar documento', exact: true }).click();
      const oversizedForm = page
        .locator('form')
        .filter({ has: page.getByLabel('Nome do documento') });
      await oversizedForm.getByLabel('Nome do documento').fill(oversizedTitle);
      await oversizedForm.getByLabel('Visibilidade').selectOption('INTERNAL');
      await oversizedForm.getByLabel('Arquivo').setInputFiles({
        name: `large-${suffix}.pdf`,
        mimeType: 'application/pdf',
        buffer: Buffer.alloc(4 * 1024 * 1024 + 1, 0x41),
      });
      const oversizedUpload = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/v1/documents' &&
          response.request().method() === 'POST',
      );
      await oversizedForm.getByRole('button', { name: 'Enviar documento' }).click();
      expect((await oversizedUpload).status()).toBe(413);
      await expect(page.getByRole('status')).toContainText('Erro:');
      await expect(page.getByRole('row').filter({ hasText: oversizedTitle })).toHaveCount(0);
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
      await login(page, 'admin.aurora@example.test');
      const suffix = randomUUID().slice(0, 8);
      const title = `Tarefa QA ${suffix}`;
      await page.locator('#primary-navigation').getByRole('button', { name: 'Tarefas' }).click();
      await page.getByRole('button', { name: 'Nova tarefa' }).click();
      await page.getByLabel('O que precisa ser feito').fill(title);
      const taskForm = page.locator('form').filter({
        has: page.getByRole('button', { name: 'Criar tarefa', exact: true }),
      });
      await taskForm.locator('select[name="priority"]').selectOption('HIGH');
      await expect(taskForm.locator('select[name="assigneeId"]')).toBeEnabled();
      await taskForm.locator('select[name="assigneeId"]').selectOption(lawyerUserA);
      const taskResponse = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/v1/tasks' &&
          response.request().method() === 'POST',
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
      assertStatus(
        crossOrganizationDocument,
        404,
        'client cannot read a document from another organization',
      );
      const crossOrganizationClientList = await browserApi(
        otherOrganizationClientPage,
        '/clients?page=1&pageSize=5',
        { organizationId: organizationA },
      );
      assertStatus(crossOrganizationClientList, 401, 'client cannot select another organization');

      await login(clientPage, 'cliente.aurora@example.test');
      await expect(clientPage.getByRole('heading', { name: /Minha/ })).toBeVisible();
      await expect(
        clientPage.getByRole('button', { name: new RegExp(visibleTitle) }),
      ).toBeVisible();
      await expect(clientPage.getByText(internalTitle, { exact: true })).toHaveCount(0);
      await expect(clientPage.getByText(secondClientTitle, { exact: true })).toHaveCount(0);
      await screenshotEvidence(clientPage, `journey-client-portal-${viewport.width}`);

      const forbiddenInternal = await browserApi(clientPage, `/documents/${internalId}`);
      assertStatus(forbiddenInternal, 404, 'client cannot read internal document');
      const forbiddenSameOrganization = await browserApi(
        clientPage,
        `/documents/${secondClientDocumentId}`,
      );
      assertStatus(forbiddenSameOrganization, 404, 'client cannot read another client document');
      const crossOrganization = await browserApi(clientPage, '/clients?page=1&pageSize=5', {
        organizationId: organizationB,
      });
      assertStatus(crossOrganization, 401, 'client cannot select another organization');

      const message = `Mensagem sintética QA ${suffix}`;
      await clientPage.getByLabel(/Responder ao escrit/).fill(message);
      await clientPage.getByRole('button', { name: 'Enviar mensagem' }).click();
      await expect(clientPage.getByRole('status')).toContainText('Mensagem enviada');
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
      assertStatus(
        secondClientCannotReadFirst,
        404,
        'second same-organization client cannot read first client document',
      );

      const firstOrganizationCannotReadSecond = await browserApi(
        adminPage,
        `/documents/${otherOrganizationDocumentId}`,
      );
      assertStatus(
        firstOrganizationCannotReadSecond,
        404,
        'first organization cannot read second organization document',
      );
      const secondOrganizationCannotReadFirst = await browserApi(
        otherOrganizationPage,
        `/documents/${visibleDocumentId}`,
        { organizationId: organizationB },
      );
      assertStatus(
        secondOrganizationCannotReadFirst,
        404,
        'second organization cannot read first organization document',
      );

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
