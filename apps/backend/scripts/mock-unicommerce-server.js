#!/usr/bin/env node
/**
 * Standalone mock Unicommerce SERVER — no driver, no local backend, no DB.
 *
 * Listens on MOCK_UC_PORT (default 4400) for the two outbound calls a real
 * Unicommerce deployment receives from this connector (order push, cancel
 * push). Response shape mirrors Unicommerce's REAL confirmed contract exactly
 * (TRD §3.8/§3.9, verified directly against postorders.html/
 * postorderscancel.html): `{ status: "success"|"failure", message, data: null }`
 * — no `successful` boolean, no `saleOrderCode` (or any order-identifying
 * field) anywhere in a real response.
 *
 * Use this to test a REAL deployed backend (e.g. on EC2) by port-forwarding
 * its outbound calls back to this process — point that deployment's
 * `UC_GENERICPROXY_BASE_URL` at wherever the forward terminates. This is the
 * server half of scripts/mock-unicommerce.js, extracted standalone (that
 * script's driver half actively calls a local BACKEND_URL and seeds a DB row,
 * neither of which apply when testing a remote deployment through a tunnel).
 *
 * Usage:
 *   node scripts/mock-unicommerce-server.js
 *   MOCK_UC_PORT=4400 node scripts/mock-unicommerce-server.js
 */
const http = require('node:http');

const MOCK_PORT = Number(process.env.MOCK_UC_PORT || 4400);

function log(step, msg, extra) {
  const line = `[${new Date().toISOString()}] [${step}] ${msg}`;
  if (extra !== undefined) console.log(line, JSON.stringify(extra));
  else console.log(line);
}

function respondJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(text);
}

function pickHeaders(h) {
  return {
    clientid: h['clientid'],
    merchantid: h['merchantid'],
    securitykey: h['securitykey'] ? '***redacted***' : undefined,
  };
}

// Unicommerce's REAL response envelope (TRD §3.8/§3.9) — both outbound
// endpoints share this exact shape. No `successful` boolean, no
// `saleOrderCode`/order-identifying field of any kind.
function ucSuccess(res) {
  respondJson(res, 200, { status: 'success', message: null, data: null });
}

const received = { orderPush: [], cancelPush: [] };

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

server.listen(MOCK_PORT, () => {
  log('MOCK-UC-SERVER', `listening on :${MOCK_PORT}, waiting for outbound pushes`);
  log('MOCK-UC-SERVER', 'Ctrl+C to stop. Received counts so far: order_push=0, cancel_push=0');
});

process.on('SIGINT', () => {
  log('MOCK-UC-SERVER', `shutting down — received order_push=${received.orderPush.length}, cancel_push=${received.cancelPush.length}`);
  server.close(() => process.exit(0));
});
