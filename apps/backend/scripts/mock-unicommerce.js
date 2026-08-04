#!/usr/bin/env node
/**
 * One-off mock Unicommerce server + test driver for full local end-to-end
 * testing of the unicommerce MP connector. Two roles in one process:
 *
 *  1. SERVER — listens on MOCK_UC_PORT (default 4400) for the two outbound
 *     calls our app makes (order push, cancel push). Response shape mirrors
 *     Unicommerce's REAL confirmed contract exactly (TRD §2.9/§2.10,
 *     verified directly against postorders.html/postorderscancel.html):
 *     `{ status: "success"|"failure", message, data: null }` — there is no
 *     `successful` boolean and no `saleOrderCode` (or any order-identifying
 *     field) anywhere in a real response. Point the app at it via
 *     `UC_GENERICPROXY_BASE_URL=http://localhost:4400` in .env.
 *
 *  2. DRIVER — once the server is listening, plays Unicommerce (hitting our
 *     inbound authToken/updateInventory/products/dispatch/status/cancel
 *     APIs) AND plays Ratio (POSTing the webhook deliveries that trigger our
 *     order-push/cancel-push flow), against the real running backend.
 *     Polls the actual DB state (uc_sync_jobs/uc_order_item_map) rather than
 *     guessing sleep durations, so assertions reflect what really happened,
 *     not what the mock server merely received.
 *
 * Self-seeds a FRESH merchant row (direct DB insert, unique id per run) so
 * the script is re-runnable without colliding with a previous run's
 * uc_credentials row (merchant_id is that table's primary key).
 *
 * Known local-only limitation (not a bug in this script or the connector):
 * the dispatch/status/cancel-in and inventory/catalog endpoints ALSO call
 * Ratio's own API, which requires a real `oauth_tokens` row from Ratio's
 * OAuth install flow — this sandbox has no such row for a freshly-seeded
 * merchant, so those specific Ratio-side writes fail with "no Ratio
 * oauth_tokens row for merchant ...". That failure is asserted as EXPECTED
 * here (and must arrive as a clean structured error, never a raw 500) —
 * confirming Unicommerce-facing schema/response-contract correctness does
 * not require a live Ratio sandbox. Only the mock-UC-facing outbound loop
 * (order push / cancel push, this script's actual subject) needs a full
 * real success to prove the connector genuinely completed the round trip.
 *
 * Usage:
 *   BACKEND_URL=http://localhost:3000 node scripts/mock-unicommerce.js
 */
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const { config: loadDotenv } = require('dotenv');
const { Kysely, MysqlDialect, sql } = require('kysely');
const { createPool } = require('mysql2');

function findUp(filename) {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.resolve(dir, filename);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
for (const [file, override] of [['.env', false], ['.env.local', true]]) {
  const found = findUp(file);
  if (found) loadDotenv({ path: found, override });
}

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3000';
const MOCK_PORT = Number(process.env.MOCK_UC_PORT || 4400);
const MERCHANT_ID = `uc-e2e-${Date.now()}-${Math.floor(Math.random() * 1e4)}`;

const received = { orderPush: [], cancelPush: [] };
let db;

function log(step, msg, extra) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${step}] ${msg}`, extra !== undefined ? JSON.stringify(extra) : '');
}

async function seedMerchant() {
  const dbUrl = process.env.RATIO_UNICOMMERCE_DATABASE_URL;
  if (!dbUrl) throw new Error('RATIO_UNICOMMERCE_DATABASE_URL is not set');
  const pool = createPool({ uri: dbUrl, connectionLimit: 3 });
  db = new Kysely({ dialect: new MysqlDialect({ pool }) });
  await db
    .insertInto('merchants')
    .values({ id: MERCHANT_ID })
    .onDuplicateKeyUpdate({ id: sql`id` })
    .execute();
  log('SEED', `seeded fresh merchant '${MERCHANT_ID}'`);
}

function respondJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function pickHeaders(h) {
  return {
    clientid: h['clientid'],
    merchantid: h['merchantid'],
    securitykey: h['securitykey'] ? '***redacted***' : undefined,
  };
}

// Unicommerce's REAL response envelope (TRD §2.9/§2.10) — both outbound
// endpoints share this exact shape. No `successful` boolean, no
// `saleOrderCode`/order-identifying field of any kind.
function ucSuccess(res) {
  respondJson(res, 200, { status: 'success', message: null, data: null });
}

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let parsed = null;
    try {
      parsed = body ? JSON.parse(body) : null;
    } catch {
      /* non-JSON body — leave parsed null */
    }

    log('MOCK-UC-SERVER', `received ${req.method} ${req.url}`, {
      headers: pickHeaders(req.headers),
      body: parsed,
    });

    if (req.method === 'POST' && req.url === '/uc/v1/order') {
      received.orderPush.push(parsed);
      ucSuccess(res);
      return;
    }
    if (req.method === 'POST' && req.url === '/uc/v1/order/cancel') {
      received.cancelPush.push(parsed);
      ucSuccess(res);
      return;
    }
    respondJson(res, 404, { status: 'failure', message: 'unknown mock route', data: null });
  });
});

// Every response (success or error) is wrapped by the global interceptor as
// `{ status_code, message, data }` (errors instead carry `error_code`/
// `details` alongside `message`). Unwrap `.data` for the success shape the
// individual endpoint handlers actually return; leave error bodies as-is.
function unwrap(json) {
  if (json && typeof json === 'object' && 'data' in json) return json.data;
  return json;
}

async function call(step, method, path, opts = {}) {
  const url = `${BACKEND_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* non-JSON response */
  }
  log(step, `${method} ${path} -> ${res.status}`, json);
  return { status: res.status, body: unwrap(json), raw: json };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, { timeoutMs = 15000, intervalMs = 300, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await fn();
    if (result) return result;
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
    await sleep(intervalMs);
  }
}

const TERMINAL_JOB_STATUSES = new Set(['DONE', 'NEEDS_MANUAL']);

async function getSyncJob(ratioOrderId, type) {
  const { rows } = await sql`
    SELECT status, sale_order_code AS saleOrderCode, attempt_count AS attemptCount
    FROM uc_sync_jobs
    WHERE merchant_id = ${MERCHANT_ID} AND ratio_order_id = ${ratioOrderId} AND type = ${type}
    ORDER BY created_at DESC LIMIT 1
  `.execute(db);
  return rows[0] || null;
}

// A PENDING/IN_PROGRESS/RETRYING row exists as soon as the webhook commits —
// that's not "resolved", just "enqueued". Wait specifically for a TERMINAL
// status (the Kafka consumer having actually run the job), not merely for
// the row to exist, or every downstream step races the async consumer.
async function waitForSyncJobResolved(ratioOrderId, type, label) {
  return waitFor(
    async () => {
      const job = await getSyncJob(ratioOrderId, type);
      return job && TERMINAL_JOB_STATUSES.has(job.status) ? job : null;
    },
    { label: label ?? `${type} job for ${ratioOrderId} to reach a terminal status`, timeoutMs: 20000 },
  );
}

async function getOrderItems(ratioOrderId) {
  const { rows } = await sql`
    SELECT order_item_id AS orderItemId, ratio_line_item_id AS ratioLineItemId,
           ordered_quantity AS orderedQuantity, remaining_quantity AS remainingQuantity,
           source, last_status AS lastStatus
    FROM uc_order_item_map
    WHERE merchant_id = ${MERCHANT_ID} AND ratio_order_id = ${ratioOrderId}
    ORDER BY ratio_line_item_id ASC
  `.execute(db);
  return rows;
}

function buildOrderPayload(orderId, orderName, lineItems) {
  return {
    id: orderId,
    name: orderName,
    created_at: new Date().toISOString(),
    email: 'buyer@example.com',
    payment_gateway_names: ['razorpay'],
    total_discounts: 0,
    shipping_lines: [{ price: 40 }],
    shipping_address: {
      first_name: 'Jane', last_name: 'Doe', address1: '221B Baker St',
      city: 'Mumbai', province: 'Maharashtra', country: 'India', zip: '400001', phone: '9999999999',
    },
    billing_address: {
      first_name: 'Jane', last_name: 'Doe', address1: '221B Baker St',
      city: 'Mumbai', province: 'Maharashtra', country: 'India', zip: '400001', phone: '9999999999',
    },
    line_items: lineItems,
  };
}

async function pushOrderAndWait(step, orderId, orderName, lineItems) {
  const webhook = await call(`WEBHOOK orders/create (${step})`, 'POST', '/unicommerce/api/v1/oauth/webhook', {
    headers: { 'x-webhook-id': crypto.randomUUID() },
    body: { event_type: 'orders/create', merchant_id: MERCHANT_ID, product: buildOrderPayload(orderId, orderName, lineItems) },
  });
  if (webhook.status !== 200) throw new Error(`${step}: orders/create webhook returned ${webhook.status}`);

  const job = await waitForSyncJobResolved(orderId, 'order_push', `${step}: order_push job to reach a terminal status`);
  log('ASSERT', `${step}: order_push job resolved`, job);
  return job;
}

async function main() {
  await seedMerchant();
  await new Promise((resolve) => server.listen(MOCK_PORT, resolve));
  log('MOCK-UC-SERVER', `listening on :${MOCK_PORT}, waiting for outbound pushes from the app`);

  const results = {};

  // --- Step 0: connect flow — admin generates merchant credentials ---
  const ucUsername = 'merchant-uc-login-001';
  const connect = await call('CONNECT', 'POST', '/unicommerce/admin/credentials/generate', {
    body: { merchantId: MERCHANT_ID, ucUsername },
  });
  results.connect = connect.status === 200 || connect.status === 201;
  const { username, password } = connect.body || {};

  // --- Inbound API #1: GET /authToken ---
  const auth = await call(
    'AUTH',
    'GET',
    `/unicommerce/api/v1/authToken?username=${encodeURIComponent(username || '')}&password=${encodeURIComponent(password || '')}`,
  );
  results.authToken = !!(auth.body && auth.body.status === 'SUCCESS');
  const apiKey = auth.body && auth.body.accessToken;

  // --- Inbound API #2: POST /updateInventory (direct productId/variantId,
  // no SKU-cache lookup — confirmed contract, TRD §2.5 / connector fix) ---
  const inventory = await call('UPDATE-INVENTORY', 'POST', '/unicommerce/api/v1/updateInventory', {
    headers: { apikey: apiKey },
    body: { inventoryList: [{ productId: 'product-1', variantId: 'variant-1', inventory: '25', facilityCode: 'DEL01' }] },
  });
  results.updateInventory = inventory.status === 200 || inventory.status === 201;
  if (inventory.body && inventory.body.status && inventory.body.status !== 'SUCCESS') {
    log('UPDATE-INVENTORY', 'NOTE: non-SUCCESS is the expected local-only Ratio-OAuth limitation (see script header) — request validation and DB writes are still fully exercised above that boundary.');
  }

  // --- Inbound API #3: GET /productsCount + /products ---
  const productsCount = await call('PRODUCTS-COUNT', 'GET', '/unicommerce/api/v1/productsCount', { headers: { apikey: apiKey } });
  results.productsCount = productsCount.status === 200;
  const products = await call('PRODUCTS', 'GET', '/unicommerce/api/v1/products?pageNumber=1', { headers: { apikey: apiKey } });
  results.products = products.status === 200;

  // --- Core loop, Order A: Ratio orders/create webhook -> order push -> mock UC ---
  // Two line items so the later UC-initiated cancel below genuinely exercises
  // the PARTIAL-cancel branch (TRD §2.7 / connector fix): cancelling only
  // line-2 must PATCH survivors, not cancel the whole order.
  const orderAId = `order-e2e-${Date.now()}-A`;
  const orderAJob = await pushOrderAndWait('ORDER-A', orderAId, '#E2E-A', [
    { id: 'line-1', product_id: 'product-1', variant_id: 'variant-1', sku: 'SKU-1', title: 'T-Shirt', quantity: 2, price: '499.00' },
    { id: 'line-2', product_id: 'product-2', variant_id: 'variant-2', sku: 'SKU-2', title: 'Shorts', quantity: 1, price: '299.00' },
  ]);
  results.orderAPushed = orderAJob && orderAJob.status === 'DONE' && orderAJob.saleOrderCode === orderAId;
  results.orderPushReceivedByMockUc = received.orderPush.length > 0;
  if (received.orderPush[0]) {
    const sent = received.orderPush[0];
    results.orderPushPayloadShape =
      sent.orderStatus === 'CREATED' &&
      sent.orderItems && sent.orderItems.length === 2 &&
      sent.orderItems[0].productId === 'product-1' &&
      typeof sent.orderPrice === 'object' &&
      !('saleOrderDTO' in sent); // the old, wrong wrapper must never reappear
  }

  const orderAItems = await getOrderItems(orderAId);
  const item1 = orderAItems.find((i) => i.ratioLineItemId === 'line-1');
  const item2 = orderAItems.find((i) => i.ratioLineItemId === 'line-2');
  results.orderItemMapPopulated = !!item1 && !!item2 && item1.orderedQuantity === 2 && item2.orderedQuantity === 1;

  // --- UC -> us API: POST /orders/dispatch (full dispatch of line-1) ---
  const dispatch = await call('DISPATCH', 'POST', '/unicommerce/api/v1/orders/dispatch', {
    headers: { apikey: apiKey },
    body: {
      orderItems: [{ orderItemId: item1.orderItemId, quantity: 2, taxRate: 18 }],
      selfShipping: {
        deliveryPartner: 'Self', deliveryCourier: 'Delhivery', dispatchDate: '2026-07-30',
        invoiceNumber: 'INV-1', invoiceDate: '2026-07-30', trackingId: 'AWB123',
        trackingURL: 'https://track.example.com/AWB123', tentativeDeliveryDate: '2026-08-02',
      },
    },
  });
  // Never a raw 500 — either a genuine SUCCESS or a structured per-item
  // errorMessage (the local-only Ratio-OAuth limitation), never an
  // uncaught-exception 500 (the bug this session's fix closed).
  results.dispatchStructuredResponse = dispatch.status === 200 && dispatch.body && Array.isArray(dispatch.body.orderItems);

  // --- UC -> us API: POST /order/:orderId (status notification) ---
  const statusNotify = await call('STATUS-NOTIFY', 'POST', `/unicommerce/api/v1/order/${orderAId}`, {
    headers: { apikey: apiKey },
    body: { orderItems: [{ orderItemId: item1.orderItemId, status: 'DISPATCHED', IsReverse: false, updated: new Date().toISOString() }] },
  });
  // Confirmed hard contract: this endpoint must ALWAYS return SUCCESS at the
  // top level, no matter what happened internally.
  results.statusNotifyAlwaysSuccess = statusNotify.status === 200 && statusNotify.body && statusNotify.body.status === 'SUCCESS';

  // --- UC -> us API: POST /orders/cancel (partial cancel — line-2 only) ---
  const ucCancel = await call('UC-CANCEL', 'POST', '/unicommerce/api/v1/orders/cancel', {
    headers: { apikey: apiKey },
    body: { orderId: orderAId, orderItems: [{ orderItemId: item2.orderItemId, productId: 'product-2', variantId: 'variant-2', quantity: 1 }] },
  });
  results.ucCancelStructuredResponse = ucCancel.status === 200 && ucCancel.body && Array.isArray(ucCancel.body.orderItems);

  // --- Core loop, Order B: separate order, Ratio-initiated cancel -> outbound cancel push -> mock UC ---
  const orderBId = `order-e2e-${Date.now()}-B`;
  const orderBJob = await pushOrderAndWait('ORDER-B', orderBId, '#E2E-B', [
    { id: 'line-1', product_id: 'product-3', variant_id: 'variant-3', sku: 'SKU-3', title: 'Cap', quantity: 1, price: '199.00' },
  ]);
  results.orderBPushed = orderBJob && orderBJob.status === 'DONE';

  const cancelWebhook = await call('WEBHOOK orders/cancelled (ORDER-B)', 'POST', '/unicommerce/api/v1/oauth/webhook', {
    headers: { 'x-webhook-id': crypto.randomUUID() },
    body: { event_type: 'orders/cancelled', merchant_id: MERCHANT_ID, product: { id: orderBId } },
  });
  results.cancelWebhook = cancelWebhook.status === 200;

  const cancelJob = await waitForSyncJobResolved(orderBId, 'cancel_push', 'ORDER-B: cancel_push job to reach a terminal status');
  log('ASSERT', 'ORDER-B: cancel_push job resolved', cancelJob);
  results.cancelPushDone = cancelJob && cancelJob.status === 'DONE';
  results.cancelPushReceivedByMockUc = received.cancelPush.length > 0;

  console.log('\n========== SUMMARY ==========');
  for (const [k, v] of Object.entries(results)) {
    console.log(`${v ? 'PASS' : 'FAIL'}  ${k}`);
  }
  console.log('==============================\n');

  server.close();
  await db.destroy();

  const coreFlowOk =
    results.connect &&
    results.authToken &&
    results.orderAPushed &&
    results.orderPushReceivedByMockUc &&
    results.orderPushPayloadShape &&
    results.orderItemMapPopulated &&
    results.dispatchStructuredResponse &&
    results.statusNotifyAlwaysSuccess &&
    results.ucCancelStructuredResponse &&
    results.orderBPushed &&
    results.cancelWebhook &&
    results.cancelPushDone &&
    results.cancelPushReceivedByMockUc;
  process.exit(coreFlowOk ? 0 : 1);
}

main().catch(async (err) => {
  console.error('FATAL', err);
  server.close();
  if (db) await db.destroy();
  process.exit(1);
});
