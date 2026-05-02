export type BrowserUseTargetAuth = 'authenticated' | 'unauthenticated' | 'unknown';

export type BrowserUseCdpTarget = {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
  auth: BrowserUseTargetAuth;
  composer: boolean;
  textareaCount: number;
  probeError?: string;
};

export type BrowserUseTargetListOptions = {
  cdpUrl?: string;
  probe?: boolean;
  timeoutMs?: number;
};

type ChromeTarget = {
  id?: unknown;
  type?: unknown;
  title?: unknown;
  url?: unknown;
  webSocketDebuggerUrl?: unknown;
};

type PageProbe = {
  title?: unknown;
  text?: unknown;
  textareas?: unknown;
};

const DEFAULT_CDP_URL = 'http://127.0.0.1:56663';
const DEFAULT_TIMEOUT_MS = 2500;

const CHAT_TARGET_PROBE = `(() => {
  const text = String(document.body?.innerText || "");
  const textareas = [...document.querySelectorAll("textarea")].map((textarea) => ({
    placeholder: textarea.placeholder || "",
    disabled: Boolean(textarea.disabled),
    value: textarea.value || "",
  }));
  return {
    title: document.title || "",
    text: text.slice(0, 3000),
    textareas,
  };
})()`;

export async function listBrowserUseCdpTargets(
  options: BrowserUseTargetListOptions = {},
): Promise<BrowserUseCdpTarget[]> {
  const cdpUrl = normalizeCdpUrl(options.cdpUrl);
  const probe = options.probe !== false;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const targets = await fetchChromeTargets(cdpUrl, timeoutMs);

  const rows: BrowserUseCdpTarget[] = [];
  for (const target of targets) {
    const row = normalizeChromeTarget(target);
    if (probe && row.url.includes('/apps/chat') && row.webSocketDebuggerUrl) {
      rows.push(await probeChatTarget(row, timeoutMs));
    } else {
      rows.push(row);
    }
  }
  return rows;
}

export function selectBestChatTarget(targets: readonly BrowserUseCdpTarget[]): BrowserUseCdpTarget | undefined {
  return targets
    .filter((target) => target.url.includes('/apps/chat'))
    .filter((target) => target.webSocketDebuggerUrl)
    .filter((target) => target.auth !== 'unauthenticated')
    .filter((target) => target.composer)
    .sort((left, right) => scoreChatTarget(right) - scoreChatTarget(left))[0];
}

export function formatBrowserUseTargets(targets: readonly BrowserUseCdpTarget[]): string {
  const lines = ['id\turl\tauth\tcomposer\ttitle'];
  for (const target of targets) {
    const composer = target.composer ? 'yes' : 'no';
    const title = target.probeError ? `${target.title} (${target.probeError})` : target.title;
    lines.push(`${target.id}\t${target.url}\t${target.auth}\t${composer}\t${title}`);
  }
  return lines.join('\n');
}

export function printAttachChatExports(target: BrowserUseCdpTarget, cdpUrl = DEFAULT_CDP_URL): void {
  console.log(`export PIBO_CDP_URL=${shellQuote(normalizeCdpUrl(cdpUrl))}`);
  console.log(`export PIBO_CDP_TARGET_ID=${shellQuote(target.id)}`);
  console.log(`export PIBO_CDP_TARGET_WS=${shellQuote(target.webSocketDebuggerUrl ?? '')}`);
  console.log(`export PIBO_CHAT_URL=${shellQuote(target.url)}`);
}

function normalizeCdpUrl(value?: string): string {
  return (value || DEFAULT_CDP_URL).replace(/\/+$/, '');
}

async function fetchChromeTargets(cdpUrl: string, timeoutMs: number): Promise<ChromeTarget[]> {
  const response = await fetchWithTimeout(`${cdpUrl}/json/list`, timeoutMs);
  if (!response.ok) {
    throw new Error(`Chrome target discovery failed: ${response.status} ${response.statusText}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload)) throw new Error('Chrome target discovery returned invalid JSON');
  return payload as ChromeTarget[];
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeChromeTarget(target: ChromeTarget): BrowserUseCdpTarget {
  return {
    id: stringValue(target.id),
    type: stringValue(target.type),
    title: stringValue(target.title),
    url: stringValue(target.url),
    webSocketDebuggerUrl: optionalStringValue(target.webSocketDebuggerUrl),
    auth: 'unknown',
    composer: false,
    textareaCount: 0,
  };
}

async function probeChatTarget(target: BrowserUseCdpTarget, timeoutMs: number): Promise<BrowserUseCdpTarget> {
  try {
    const probe = await evaluateCdp(target.webSocketDebuggerUrl!, CHAT_TARGET_PROBE, timeoutMs);
    return applyProbe(target, probe);
  } catch (error) {
    return {
      ...target,
      probeError: error instanceof Error ? error.message : String(error),
    };
  }
}

function applyProbe(target: BrowserUseCdpTarget, probe: PageProbe): BrowserUseCdpTarget {
  const text = stringValue(probe.text);
  const textareas = Array.isArray(probe.textareas) ? probe.textareas : [];
  const composer = textareas.some((textarea) => {
    if (!isRecord(textarea)) return false;
    return textarea.disabled !== true;
  });
  return {
    ...target,
    title: stringValue(probe.title) || target.title,
    auth: classifyAuth(text, composer),
    composer,
    textareaCount: textareas.length,
  };
}

function classifyAuth(text: string, composer: boolean): BrowserUseTargetAuth {
  if (/Unauthenticated|Sign in with Google|Sign in/i.test(text)) return 'unauthenticated';
  if (composer) return 'authenticated';
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(text)) return 'authenticated';
  return 'unknown';
}

function scoreChatTarget(target: BrowserUseCdpTarget): number {
  return (
    (target.auth === 'authenticated' ? 100 : 0) +
    (target.composer ? 50 : 0) +
    (target.url.includes('/sessions/') ? 20 : 0) +
    (target.url.includes('/rooms/') ? 10 : 0)
  );
}

async function evaluateCdp(webSocketUrl: string, expression: string, timeoutMs: number): Promise<PageProbe> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl);
    let nextId = 0;
    let settled = false;
    const timer = setTimeout(() => fail(new Error('Timed out waiting for CDP target')), timeoutMs);

    function settle(): boolean {
      if (settled) return false;
      settled = true;
      clearTimeout(timer);
      try {
        socket.close();
      } catch {
        // The target may fail before the WebSocket reaches OPEN.
      }
      return true;
    }

    function succeed(value: PageProbe): void {
      if (settle()) resolve(value);
    }

    function fail(error: Error): void {
      if (settle()) reject(error);
    }

    function send(method: string, params?: Record<string, unknown>): number {
      const id = ++nextId;
      socket.send(JSON.stringify({ id, method, params }));
      return id;
    }

    socket.addEventListener('open', () => {
      send('Runtime.evaluate', { expression, returnByValue: true });
    });
    socket.addEventListener('message', (event) => {
      const message = parseJson(String(event.data));
      if (!isRecord(message) || typeof message.id !== 'number') return;
      if (isRecord(message.error)) {
        fail(new Error(JSON.stringify(message.error)));
        return;
      }
      const result = isRecord(message.result) ? message.result : undefined;
      const runtimeResult = result && isRecord(result.result) ? result.result : undefined;
      const value = runtimeResult && isRecord(runtimeResult.value) ? runtimeResult.value : {};
      succeed(value as PageProbe);
    });
    socket.addEventListener('error', () => {
      fail(new Error('CDP WebSocket error'));
    });
  });
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function optionalStringValue(value: unknown): string | undefined {
  const text = stringValue(value);
  return text || undefined;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
