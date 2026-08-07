import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CLEVERTAP_PIXEL_BUNDLE = readFileSync(
  join(__dirname, '../../../../../static/clevertap-pixel.js'),
  'utf8',
);

export const EXPECTED_SDK_URL = 'https://d2r1yp2w7bby2u.cloudfront.net/js/clevertap.min.js';

export interface UserData {
  external_id?: string;
  email?: string;
  phone?: string;
  first_name?: string;
  last_name?: string;
}

export interface PixelEventLike {
  event_type?: string;
  properties?: Record<string, unknown>;
  metadata?: {
    session_id?: string;
    event_id?: string;
    user_data?: UserData;
    page?: { url?: string; path?: string; title?: string; referrer?: string };
  };
}

export type QueueCall = unknown[];

interface RecordingQueue {
  calls: QueueCall[];
  push(...args: unknown[]): number;
}

export interface ClevertapStub {
  event: RecordingQueue;
  profile: RecordingQueue;
  account: RecordingQueue;
  onUserLogin: RecordingQueue;
  notifications: RecordingQueue;
  privacy: RecordingQueue;
  region?: string;
}

export interface InjectedScript {
  tagName?: string;
  type?: string;
  async?: boolean;
  src?: string;
}

export interface HarnessOptions {
  config?: unknown;
  noConfig?: boolean;
  runtime?: boolean;
  stubClevertap?: boolean;
  throwOn?: 'event' | 'onUserLogin' | 'account';
  openstoreUser?: unknown;
  cookie?: string;
  localStorage?: Record<string, string> | 'throw';
}

export interface PixelHarness {
  window: Record<string, unknown>;
  clevertap: ClevertapStub | undefined;
  rawClevertap: () => unknown;
  registrations: Record<string, { name: string; register: (analytics: unknown) => void }>;
  pending: () => Array<{ name: string; register: (analytics: unknown) => void }>;
  handlers: Record<string, Array<(event: PixelEventLike) => void>>;
  subscribed: (osName: string) => boolean;
  registerAll: () => void;
  emit: (osName: string, event?: PixelEventLike) => void;
  scripts: InjectedScript[];
  logs: unknown[][];
  warns: unknown[][];
  errors: unknown[][];
  events: () => Array<[string, Record<string, unknown>]>;
  logins: () => Array<Record<string, unknown>>;
  order: string[];
  postMessage: (origin: unknown, data: unknown) => void;
  fireWindowEvent: (name: string) => void;
  listenerCount: (type: string) => number;
  openstoreUser: () => Record<string, unknown> | undefined;
  setOpenstoreUser: (value: unknown) => void;
}

const DEFAULT_EVENT_MAP: Record<string, string> = {
  PageView: 'Page Browse',
  ViewContent: 'Product Viewed',
  AddToCart: 'Added to Cart',
  InitiateCheckout: 'Checkout Initiated',
  Purchase: 'Charged',
  Search: 'Search',
};

export function makeConfig(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    accountId: 'TEST-ACC-ID',
    region: 'in1',
    apiHost: 'https://in1.api.clevertap.com',
    debug: false,
    merchantId: 'm1',
    eventNameMap: { ...DEFAULT_EVENT_MAP },
    ...overrides,
  };
}

export function makeEvent(
  osName: string,
  opts: { properties?: Record<string, unknown>; user?: UserData | null; sessionId?: string } = {},
): PixelEventLike {
  const metadata: NonNullable<PixelEventLike['metadata']> = {
    session_id: opts.sessionId ?? 's1',
    event_id: 'e1',
    page: { url: 'https://store.example/p/1', path: '/p/1', title: 'Product', referrer: '' },
  };
  if (opts.user) metadata.user_data = opts.user;
  return { event_type: osName, properties: opts.properties ?? {}, metadata };
}

export function loadPixel(options: HarnessOptions = {}): PixelHarness {
  const order: string[] = [];

  function makeQueue(name: string, shouldThrow: boolean): RecordingQueue {
    const calls: QueueCall[] = [];
    return {
      calls,
      push(...args: unknown[]): number {
        order.push(name);
        calls.push(args);
        if (shouldThrow) throw new Error(`${name}.push exploded`);
        return calls.length;
      },
    };
  }

  const stub = options.stubClevertap === false;
  const clevertap: ClevertapStub | undefined = stub
    ? undefined
    : {
        event: makeQueue('event', options.throwOn === 'event'),
        profile: makeQueue('profile', false),
        account: makeQueue('account', options.throwOn === 'account'),
        onUserLogin: makeQueue('onUserLogin', options.throwOn === 'onUserLogin'),
        notifications: makeQueue('notifications', false),
        privacy: makeQueue('privacy', false),
      };

  const registrations: PixelHarness['registrations'] = {};
  const handlers: PixelHarness['handlers'] = {};
  const scripts: InjectedScript[] = [];
  const logs: unknown[][] = [];
  const warns: unknown[][] = [];
  const errors: unknown[][] = [];

  const listeners: Record<string, Array<(ev: unknown) => void>> = {};

  const win: Record<string, unknown> = {
    addEventListener: (type: string, fn: (ev: unknown) => void) => {
      const list = listeners[type] ?? [];
      listeners[type] = list;
      list.push(fn);
    },
    removeEventListener: (type: string, fn: (ev: unknown) => void) => {
      listeners[type] = (listeners[type] ?? []).filter((f) => f !== fn);
    },
  };
  if (options.openstoreUser !== undefined) win.__openstore_user = options.openstoreUser;
  if (options.localStorage === 'throw') {
    win.localStorage = {
      getItem: (): string | null => {
        throw new Error('SecurityError: localStorage is disabled');
      },
    };
  } else if (options.localStorage) {
    const store = options.localStorage;
    win.localStorage = { getItem: (key: string): string | null => store[key] ?? null };
  }
  if (!options.noConfig) win.__CLEVERTAP_RATIO_CONFIG__ = options.config ?? makeConfig();
  if (clevertap) win.clevertap = clevertap;
  if (options.runtime !== false) {
    win.__OPEN_STORE_PIXEL_RUNTIME__ = {
      register: (reg: { name: string; register: (a: unknown) => void }) => {
        registrations[reg.name] = reg;
      },
    };
  }

  const doc = {
    cookie: options.cookie ?? '',
    createElement: (tag: string): InjectedScript => ({ tagName: tag }),
    getElementsByTagName: (): unknown[] => [],
    head: {
      appendChild: (el: InjectedScript) => {
        scripts.push(el);
        return el;
      },
    },
  };

  const fakeConsole = {
    log: (...args: unknown[]) => logs.push(args),
    warn: (...args: unknown[]) => warns.push(args),
    error: (...args: unknown[]) => errors.push(args),
  };

  new Function('window', 'document', 'console', CLEVERTAP_PIXEL_BUNDLE)(win, doc, fakeConsole);

  const analytics = {
    subscribe: (osName: string, fn: (e: PixelEventLike) => void) => {
      const list = handlers[osName] ?? [];
      handlers[osName] = list;
      list.push(fn);
    },
  };

  const pending = () =>
    (win.__OPEN_STORE_PIXEL_PENDING__ ?? []) as Array<{
      name: string;
      register: (a: unknown) => void;
    }>;

  const liveQueues = () => (win.clevertap ?? undefined) as ClevertapStub | undefined;

  return {
    window: win,
    clevertap,
    rawClevertap: () => win.clevertap,
    registrations,
    pending,
    handlers,
    scripts,
    logs,
    warns,
    errors,
    order,
    subscribed: (osName) => (handlers[osName]?.length ?? 0) > 0,
    registerAll: () => {
      for (const reg of Object.values(registrations)) reg.register(analytics);
      for (const reg of pending()) reg.register(analytics);
    },
    emit: (osName, event) => {
      for (const fn of handlers[osName] ?? []) fn(event ?? makeEvent(osName));
    },
    events: () =>
      (liveQueues()?.event.calls ?? []).map(
        (c) =>
          [c[0] as string, (c[1] ?? {}) as Record<string, unknown>] as [
            string,
            Record<string, unknown>,
          ],
      ),
    logins: () =>
      (liveQueues()?.onUserLogin.calls ?? []).map((c) => {
        const payload = (c[0] ?? {}) as { Site?: Record<string, unknown> };
        return payload.Site ?? {};
      }),
    postMessage: (origin, data) => {
      for (const fn of listeners.message ?? []) fn({ origin, data });
    },
    fireWindowEvent: (name) => {
      for (const fn of listeners[name] ?? []) fn({ type: name });
    },
    listenerCount: (type) => listeners[type]?.length ?? 0,
    openstoreUser: () => win.__openstore_user as Record<string, unknown> | undefined,
    setOpenstoreUser: (value) => {
      if (value === undefined) delete win.__openstore_user;
      else win.__openstore_user = value;
    },
  };
}
