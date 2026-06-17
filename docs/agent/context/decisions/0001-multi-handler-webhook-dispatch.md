# 0001 — Multi-handler webhook dispatch

- **Date:** 2026-06-08
- **Status:** accepted

## Context
The core `WebhooksService` + `createAppProviders` accepted exactly one
`WebhookHandler` per module, matched by a single `topic`. The google app needs
four topics (`app/uninstalled` + `products/create|update|delete`).

## Decision
Generalize the core to accept `handlers: WebhookHandler[]` (and
`handlerClasses[]` in the factory), routing `envelope.event` via a
topic→handler map. Keep the single-`handler` form working.

## Rationale
A generic capability that benefits every module, not vendor-specific logic in
`core/`. Backward-compatible: existing single-handler callers (`_template`) pass
a one-element array; all prior core tests stay green. Alternative (registering
the module N times) was rejected as a hack.

## Consequences
Duplicate topics now throw at construction (wiring error caught early). Future
multi-topic apps are first-class. `core/` boundary preserved (extended, not
forked).
