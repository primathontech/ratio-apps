interface ClevertapRatioConfig {
  accountId: string;
  region: string;
  apiHost: string;
  debug: boolean;
  merchantId: string;
  eventNameMap: Record<string, string>;
}

interface PixelEvent {
  event_type: string;
  properties?: Record<string, unknown>;
  metadata?: {
    session_id?: string;
    event_id?: string;
    user_data?: {
      external_id?: string;
      email?: string;
      phone?: string;
      first_name?: string;
      last_name?: string;
    };
    page?: { url?: string; path?: string; title?: string; referrer?: string };
  };
}

interface PixelAnalytics {
  subscribe(eventType: string, handler: (event: PixelEvent) => void): void;
}

interface ClevertapQueue {
  push(...args: unknown[]): unknown;
}

interface ClevertapGlobal {
  event: ClevertapQueue;
  profile: ClevertapQueue;
  account: ClevertapQueue;
  onUserLogin: ClevertapQueue;
  notifications: ClevertapQueue;
  privacy: ClevertapQueue;
  region?: string;
}

interface PixelRegistration {
  name: string;
  register(analytics: PixelAnalytics): void;
}

interface PixelRuntime {
  register(reg: PixelRegistration): void;
}

// biome-ignore lint/correctness/noUnusedVariables: declaration merge with lib.dom.d.ts global Window
interface Window {
  __CLEVERTAP_RATIO_CONFIG__?: ClevertapRatioConfig;
  __OPEN_STORE_PIXEL_RUNTIME__?: PixelRuntime;
  __OPEN_STORE_PIXEL_PENDING__?: PixelRegistration[];
  clevertap?: ClevertapGlobal;
  __openstore_user?: Record<string, unknown>;
}

(() => {
  const CLEVERTAP_SDK_URL = 'https://d2r1yp2w7bby2u.cloudfront.net/js/clevertap.min.js';

  const LOG = '[ClevertapRatioPixel]';

  const config = window.__CLEVERTAP_RATIO_CONFIG__;
  if (!config?.accountId || !config.region) {
    console.warn(LOG, 'config missing or incomplete — pixel did not initialize.', config);
    return;
  }
  const cfg: ClevertapRatioConfig = config;

  function put(target: Record<string, unknown>, key: string, value: unknown): void {
    if (value !== undefined && value !== null) target[key] = value;
  }

  function mapItems(contents: unknown): Record<string, unknown>[] | undefined {
    if (!Array.isArray(contents)) return undefined;
    return contents.map((raw) => {
      const c = (raw ?? {}) as Record<string, unknown>;
      const item: Record<string, unknown> = {};
      put(item, 'Product Id', c.id !== undefined ? c.id : c.product_id);
      put(item, 'Product Name', c.name !== undefined ? c.name : c.title);
      put(item, 'Price', c.item_price !== undefined ? c.item_price : c.price);
      put(item, 'Quantity', c.quantity);
      put(item, 'Category', c.category);
      return item;
    });
  }

  function mapAttributes(osName: string, event: PixelEvent): Record<string, unknown> {
    const p = event.properties ?? {};
    const m = event.metadata ?? {};
    const page = m.page ?? {};
    const attrs: Record<string, unknown> = {};
    put(attrs, 'Session Id', m.session_id);
    put(attrs, 'Event Id', m.event_id);
    put(attrs, 'Page URL', page.url);
    put(attrs, 'Page Path', page.path);
    put(attrs, 'Page Title', page.title);
    put(attrs, 'Referrer', page.referrer);
    put(attrs, 'Product Ids', p.content_ids);
    put(attrs, 'Content Type', p.content_type);
    put(attrs, 'Value', p.value);
    put(attrs, 'Currency', p.currency);
    put(attrs, 'Quantity', p.num_items);
    put(attrs, 'Order Id', p.order_id);
    put(attrs, 'Search Term', p.search_string);
    put(attrs, 'Shipping Method', p.shipping_method);
    put(attrs, 'Payment Method', p.payment_method);
    put(attrs, 'Lead Source', p.lead_source);
    put(attrs, 'Contact Method', p.contact_method);
    put(attrs, 'Subscription Type', p.subscription_type);
    put(attrs, 'Method', p.method);
    const items = mapItems(p.contents);
    if (items) attrs.Items = items;
    if (osName === 'Purchase' || event.event_type === 'Purchase') {
      put(attrs, 'Amount', p.value);
      put(attrs, 'Charged ID', p.order_id);
    }
    return attrs;
  }

  function flattenForClevertap(attrs: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(attrs)) {
      const v = attrs[key];
      if (key === 'Items') {
        out[key] = v;
      } else if (Array.isArray(v)) {
        out[key] = v.filter((x) => x != null && typeof x !== 'object').join(',');
      } else if (v === null || typeof v !== 'object') {
        out[key] = v;
      }
    }
    return out;
  }

  function normalisePhone(raw: string | undefined): string | undefined {
    if (!raw) return undefined;
    const trimmed = String(raw).trim();
    if (!trimmed) return undefined;
    const hadPlus = trimmed.charAt(0) === '+';
    let digits = trimmed.replace(/[^0-9]/g, '');
    if (!digits) return undefined;
    if (hadPlus) return `+${digits}`;
    if (digits.length > 10 && digits.substring(0, 2) === '00') digits = digits.substring(2);
    if (digits.length > 10 && digits.charAt(0) === '0') digits = digits.substring(1);
    if (digits.length === 12 && digits.substring(0, 2) === '91') return `+${digits}`;
    if (digits.length === 10) return `+91${digits}`;
    return `+${digits}`;
  }

  interface IdentityPii {
    external_id?: string;
    email?: string;
    phone?: string;
    first_name?: string;
    last_name?: string;
  }

  const PII_KEYS: ('external_id' | 'email' | 'phone' | 'first_name' | 'last_name')[] = [
    'external_id',
    'email',
    'phone',
    'first_name',
    'last_name',
  ];

  function asRecord(v: unknown): Record<string, unknown> {
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  }

  function str(v: unknown): string | undefined {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    return s === '' ? undefined : s;
  }

  function toPii(src: unknown): IdentityPii | null {
    const r = asRecord(src);
    const pii: IdentityPii = {};
    let found = false;
    for (const key of PII_KEYS) {
      const value = str(r[key]);
      if (value) {
        (pii as Record<string, string>)[key] = value;
        found = true;
      }
    }
    return found ? pii : null;
  }

  function readOpenstoreUser(): IdentityPii | null {
    try {
      return toPii(window.__openstore_user);
    } catch (e) {
      console.error(LOG, 'reading __openstore_user failed:', e);
      return null;
    }
  }

  function mergePii(primary: IdentityPii | null, extra: IdentityPii | null): IdentityPii | null {
    if (!primary) return extra;
    if (!extra) return primary;
    const out: IdentityPii = {};
    for (const key of PII_KEYS) {
      const value = primary[key] ?? extra[key];
      if (value) (out as Record<string, string>)[key] = value;
    }
    return out;
  }

  function currentPii(event?: PixelEvent): IdentityPii | null {
    return mergePii(readOpenstoreUser(), toPii(event?.metadata?.user_data));
  }

  const KWIKPASS_TOKEN_KEYS = [
    'KWIKUSERTOKEN',
    'SANDBOXKWIKUSERTOKEN',
    'QAKWIKUSERTOKEN',
    'DEVKWIKUSERTOKEN',
  ];

  function readCookie(key: string): string | null {
    try {
      const jar = document.cookie;
      if (typeof jar !== 'string' || !jar) return null;
      const parts = jar.split(';');
      for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i].trim();
        if (part.substring(0, key.length + 1) === `${key}=`) {
          return part.substring(key.length + 1) || null;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  function readStored(key: string): string | null {
    try {
      const store = window.localStorage;
      return store ? store.getItem(key) : null;
    } catch {
      return null;
    }
  }

  function hasKwikPassSession(): boolean {
    for (let i = 0; i < KWIKPASS_TOKEN_KEYS.length; i += 1) {
      const key = KWIKPASS_TOKEN_KEYS[i];
      if (readCookie(key) ?? readStored(key)) return true;
    }
    return false;
  }

  let lastIdentity: string | null = null;
  let lastSig: string | null = null;

  function identityQueues(): ClevertapGlobal | null {
    try {
      if (!window.clevertap) initClevertap();
      return ensureQueues();
    } catch (e) {
      console.error(LOG, 'clevertap init failed:', e);
      return window.clevertap ?? null;
    }
  }

  function identify(u: IdentityPii | null, source: string): void {
    const phone = normalisePhone(u?.phone);
    const email = u?.email;
    const name = [u?.first_name, u?.last_name].filter(Boolean).join(' ') || undefined;
    const identity = u ? (u.external_id ?? phone ?? email ?? null) : null;

    if (lastIdentity && !identity) {
      if (hasKwikPassSession()) {
        if (cfg.debug) console.log(LOG, 'PII absent but KwikPass session live — identity kept');
        return;
      }
      lastIdentity = null;
      lastSig = null;
      if (cfg.debug) console.log(LOG, 'identity cleared (logout)');
      return;
    }
    if (!identity || !u) return;

    const sig = `${identity}|${phone ?? ''}|${email ?? ''}|${name ?? ''}`;
    if (sig === lastSig) return;

    const ct = identityQueues();
    if (!ct) return;

    const site: Record<string, unknown> = { Identity: identity };
    put(site, 'Phone', phone);
    put(site, 'Email', email);
    put(site, 'Name', name);

    try {
      ct.onUserLogin.push({ Site: site });
      lastIdentity = identity;
      lastSig = sig;
      if (cfg.debug) console.log(LOG, 'onUserLogin:', identity, '(via', source, ')');
    } catch (e) {
      console.error(LOG, 'onUserLogin failed:', e);
    }
  }

  function syncIdentity(event?: PixelEvent, source?: string): void {
    try {
      identify(currentPii(event), source ?? 'bus');
    } catch (e) {
      console.error(LOG, 'identity sync failed:', e);
    }
  }

  const GOKWIK_ORIGIN_RE = /(^|\.)gokwik\.(co|com|in|io)$/i;

  function isGokwikOrigin(origin: unknown): boolean {
    let host = '';
    try {
      host = new URL(String(origin)).hostname;
    } catch {
      return false;
    }
    return GOKWIK_ORIGIN_RE.test(host);
  }

  function piiFromGokwik(d: Record<string, unknown>): IdentityPii | null {
    const holders: Record<string, unknown>[] = [
      asRecord(d.cartData),
      asRecord(d.cart),
      asRecord(d.data),
      asRecord(d.user),
      asRecord(d.userData),
      asRecord(d.customer),
      d,
    ];
    for (const h of holders) {
      const email = str(h.email);
      const phone = str(h.phone) ?? str(h.phone_number) ?? str(h.mobile);
      if (!email && !phone) continue;
      const pii: IdentityPii = {};
      if (email) pii.email = email;
      if (phone) pii.phone = phone;
      const ext = str(h.customer_id) ?? str(h.user_id);
      if (ext) pii.external_id = ext;
      const first = str(h.first_name);
      if (first) pii.first_name = first;
      const last = str(h.last_name);
      if (last) pii.last_name = last;
      return pii;
    }
    return null;
  }

  function publishOpenstoreUser(pii: IdentityPii): void {
    try {
      const next: Record<string, unknown> = { ...asRecord(window.__openstore_user) };
      for (const key of PII_KEYS) {
        const value = pii[key];
        if (value) next[key] = value;
      }
      window.__openstore_user = next;
    } catch (e) {
      console.error(LOG, 'publishing __openstore_user failed:', e);
    }
  }

  function attachGokwikMessages(): void {
    if (typeof window.addEventListener !== 'function') return;
    window.addEventListener('message', (msg: MessageEvent) => {
      try {
        if (!isGokwikOrigin(msg?.origin)) return;
        const d = asRecord(msg.data);
        const type = typeof d.type === 'string' ? d.type.trim() : '';
        const named = typeof d.eventName === 'string' ? d.eventName.trim() : '';
        const evName = named || type;
        if (!evName) return;
        const pii = piiFromGokwik(d);
        if (pii) publishOpenstoreUser(pii);
        const isAuth = evName === 'otpVerifiedGk' || type === 'kp_token';
        if (isAuth || pii)
          syncIdentity(undefined, isAuth ? `kwikpass:${evName}` : `gokwik:${evName}`);
      } catch (e) {
        console.error(LOG, 'GoKwik message handler failed:', e);
      }
    });
  }

  const LOGIN_EVENTS = ['user-loggedin', 'user_loggedin_merchant'];

  function attachLoginEvents(): void {
    if (typeof window.addEventListener !== 'function') return;
    for (const name of LOGIN_EVENTS) {
      window.addEventListener(name, () => {
        syncIdentity(undefined, name);
      });
    }
  }

  function ensureQueues(): ClevertapGlobal {
    const existing = window.clevertap;
    if (existing) {
      if (!existing.event) existing.event = [] as unknown[];
      if (!existing.profile) existing.profile = [] as unknown[];
      if (!existing.account) existing.account = [] as unknown[];
      if (!existing.onUserLogin) existing.onUserLogin = [] as unknown[];
      if (!existing.notifications) existing.notifications = [] as unknown[];
      if (!existing.privacy) existing.privacy = [] as unknown[];
      return existing;
    }
    const created: ClevertapGlobal = {
      event: [] as unknown[],
      profile: [] as unknown[],
      account: [] as unknown[],
      onUserLogin: [] as unknown[],
      notifications: [] as unknown[],
      privacy: [] as unknown[],
    };
    window.clevertap = created;
    return created;
  }

  let scriptInjected = false;

  function injectSdkScript(): void {
    if (scriptInjected) return;
    scriptInjected = true;
    try {
      const el = document.createElement('script');
      el.type = 'text/javascript';
      el.async = true;
      el.src = CLEVERTAP_SDK_URL;
      const first = document.getElementsByTagName('script')[0];
      if (first?.parentNode) {
        first.parentNode.insertBefore(el, first);
      } else {
        document.head.appendChild(el);
      }
    } catch (e) {
      console.error(LOG, 'SDK script injection failed:', e);
    }
  }

  let initialised = false;

  function initClevertap(): void {
    const ct = ensureQueues();
    if (!initialised) {
      initialised = true;
      ct.region = cfg.region;
      ct.account.push({ id: cfg.accountId }, cfg.region);
    }
    injectSdkScript();
  }

  const registration: PixelRegistration = {
    name: 'clevertap-ratio',
    register: (analytics) => {
      console.log(LOG, 'registering for merchant', cfg.merchantId, 'region:', cfg.region);
      try {
        initClevertap();
      } catch (e) {
        console.error(LOG, 'clevertap init failed:', e);
      }
      const eventNameMap = cfg.eventNameMap ?? {};
      Object.keys(eventNameMap).forEach((osName) => {
        const ctName = eventNameMap[osName];
        if (!ctName) return;
        analytics.subscribe(osName, (event) => {
          try {
            syncIdentity(event, osName);
            const attrs = flattenForClevertap(mapAttributes(osName, event));
            const ct = window.clevertap;
            if (ct?.event && typeof ct.event.push === 'function') {
              ct.event.push(ctName, attrs);
            } else {
              console.warn(LOG, 'CleverTap queue not ready for', ctName);
            }
            if (cfg.debug) console.log(LOG, '→', ctName, attrs);
          } catch (e) {
            console.error(LOG, osName, 'failed:', e);
          }
        });
      });
    },
  };

  attachGokwikMessages();
  attachLoginEvents();
  syncIdentity(undefined, '__openstore_user@load');

  if (window.__OPEN_STORE_PIXEL_RUNTIME__) {
    window.__OPEN_STORE_PIXEL_RUNTIME__.register(registration);
  } else {
    window.__OPEN_STORE_PIXEL_PENDING__ = window.__OPEN_STORE_PIXEL_PENDING__ ?? [];
    window.__OPEN_STORE_PIXEL_PENDING__.push(registration);
  }
})();
