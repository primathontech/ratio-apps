# SQS → Kafka Migration Plan + CleverTap Webhook Queue Design

> **Revision (implementation note).** This plan was researched before rebasing
> onto the latest `main`, which already ships a minimal Kafka wrapper
> (`apps/backend/src/core/kafka/kafka.service.ts` + `kafka-consumer.util.ts`,
> used by `unicommerce`). We therefore **extend `core/kafka` into a production
> layer** rather than build the separate `core/queue` `KafkaQueueService`
> adapter §3 proposes. Phase 1 (shipped): shared `queue-envelope` (versioned
> envelope + attempt counter) and `kafka-topics` constants; prod client config
> (SSL/SASL/timeouts); a `KafkaService.produce()` (envelope + keyed partition)
> and `sendToDlq()`; env keys; all backward-compatible so `unicommerce` is
> untouched. Next: the prod consumer/worker helper (attempt → DLQ, graceful
> shutdown) and the CleverTap webhook-queue (§5). Sections below keep the
> original SQS-interface framing for reference; the delivery semantics,
> topic map, ordering, DLQ, and rollout guidance all still apply.

Status: original proposal below. **Implementation update 2026-08-07** — the shared Kafka layer and the CleverTap forwarding path are code-complete, hardened, and green (branch `feat/sqs-to-kafka`, PR #93). The remaining-work checklist is immediately below; the original plan follows for reference.

## Remaining work (status 2026-08-07)

**Done (do not redo):** shared layer (`queue-envelope` + `decodeEnvelope`, `kafka-topics`); core `kafka.{config,service,worker}.ts` (lazy/boot-tolerant non-blocking producer with connect-dedupe, in-place exponential-backoff+jitter+heartbeat retry → DLQ, BigInt offset commits, invalid-json vs schema-mismatch DLQ reasons, `ensureTopic` finally-disconnect + no-cache-on-failure + configurable RF/partitions); CleverTap forwarding behind opt-in `CLEVERTAP_FORWARD_WORKER_ENABLED` (default off) with a transactional outbox (`claimed_at` + stale reclaim, migration 0006) and queued observability; DI boot fix (`@Optional()`). Full backend suite green (2014 tests).

**Remaining:**
1. **Run a broker per env (blocker for anything live).** Local: `docker compose up -d kafka` (KRaft service already in docker-compose; boot logs `ECONNREFUSED` without it but no longer crashes). Prod: provision MSK/Confluent + set `KAFKA_BROKERS`, `KAFKA_SSL=true`, `KAFKA_SASL_*`, `KAFKA_TOPIC_REPLICATION_FACTOR=3`; prefer pre-provisioned topics.
2. **Migrate the other apps off SQS (the point of this branch).** Still on SQS: Loyalty, Forms, Wizzy, Google, Meta; unicommerce is on the old `kafka-consumer.util.ts` wrapper. Topics already declared in `kafka-topics.ts`. Suggested order: Loyalty first, then Forms, Wizzy, Google, Meta. Follow the CleverTap forwarding worker pattern (`KafkaService.produce` + `KafkaWorker` + per-module `*_WORKER_ENABLED` flag).
3. **DLQ consumer + alerting** — nothing reads/alerts on `${topic}.dlq` yet.
4. **Retire SQS/elasticmq** once all apps are cut over.
5. **Enable + live-verify** CleverTap forwarding once a broker exists (`CLEVERTAP_FORWARD_WORKER_ENABLED=true`, confirm webhook → outbox → Kafka → CleverTap).
6. **Branch housekeeping:** after PR #92 merges to main, rebase `feat/sqs-to-kafka` onto main and retarget PR #93.

---

Repo: `ratio-apps-clevertap` (pnpm workspace; NestJS 11 + Fastify at `apps/backend`; shared package at `packages/shared`).

---

## 0. Executive framing

Today every queue-shaped workload in this backend (Google catalog sync, Wizzy
catalog sync, Meta CAPI delivery, Loyalty bulk-ops/exports, Forms
email/webhook/export delivery) is built on one thin shared wrapper —
`apps/backend/src/core/queue/queue.service.ts` — around Amazon SQS
(ElasticMQ locally). This is the "shared abstraction" the user wants replaced
with Kafka. **Every one of those apps is in the blast radius of this
change**, even though the trigger is a new, unrelated need: making CleverTap's
inbound webhook processing asynchronous so request bursts don't back up.

The plan below is deliberately staged so the two asks are separable:

1. Introduce a Kafka-backed implementation of the **same logical
   producer/consumer interface** apps already call, ship it inert, and
   migrate each existing SQS consumer app one at a time behind a flag.
2. Build CleverTap's new webhook-processing queue **directly on the new
   Kafka abstraction** (it has no legacy SQS call sites to migrate — it is
   greenfield), changing its `workerPlacement` from `none` to a worker.

---

## 1. Current state

### 1.1 The shared abstraction

`apps/backend/src/core/queue/queue.service.ts` (130 lines) is the entire
shared queue layer:

```ts
@Injectable()
export class QueueService {
  private readonly client: SQSClient;                       // line 33
  async sendBatch(name: QueueName, payloads: unknown[]): Promise<void>       // line 66
  async receive<T>(name, max=10, waitSeconds=5, visibilityTimeout?): Promise<ReceivedMessage<T>[]>  // line 89
  async ack(name: QueueName, receiptHandles: string[]): Promise<void>       // line 116
}
```

Key properties (all load-bearing for the Kafka design in §3):

- `QueueName` is just `string` (queue.service.ts:23) — any module can pass
  any name; queues are `CreateQueueCommand`-ensured lazily on first use
  (queue.service.ts:54-63), which is idempotent on both real SQS and
  ElasticMQ.
- `sendBatch` chunks to SQS's 10-per-call limit (queue.service.ts:69-80).
- `receive` long-polls up to 10 messages, returns `{ body, receiptHandle }[]`,
  and **silently drops undecodable JSON bodies** (queue.service.ts:104-112) —
  a poison-message behavior that has no Kafka equivalent (see §9).
- `ack` is an explicit delete-by-receipt-handle call, separate from
  `receive` (queue.service.ts:116-128) — this "receive, then separately ack"
  shape is exactly the Kafka consumer commit model and is why the interface
  maps cleanly (§3.2).
- Endpoint switch is a single env var: `SQS_ENDPOINT` set → ElasticMQ
  (local), unset → real regional SQS via pod IAM role (queue.service.ts:38-51,
  docstring lines 10-21).
- There is **no DLQ code in the app** — dead-lettering is entirely an SQS
  redrive policy configured as infrastructure (confirmed in every worker's
  comments, e.g. `google-product-sync.worker.ts:20-22`, and in
  `docs/DEPLOY.md:216-238`).

### 1.2 Every SQS call site (file : line, app, purpose)

| App | File : line | Purpose |
|---|---|---|
| Meta | `apps/backend/src/modules/meta/queue/queue.service.ts:12` (re-exports core `QueueService`), `:15-18` (`QUEUE_NAMES.capi = 'meta-capi'`, `capiDlq`) | Browser Conversions-API events buffered per-merchant, drained by a dedicated worker |
| Meta | `apps/backend/src/modules/meta/queue/capi.worker.ts:4,49,67,109` | `MetaCapiWorker` — `receive()` in a loop (line 67), buffers per merchant, `ack()` only after successful Graph API dispatch (line 109) |
| Meta | `apps/backend/src/modules/meta/capi/capi.service.ts:79-82` | Comment: "Phase 1 dispatches inline... TRD's 20M/day path adds a **Kafka buffer** + worker pool" — i.e. Kafka was already anticipated for Meta specifically, at higher scale |
| Google | `apps/backend/src/modules/google/gmc/google-product-sync.queue.ts:4-7` | `GOOGLE_QUEUE_NAMES = { sync: 'google-product-sync', dlq: '...-dlq' }`, `GoogleSyncMessage` union type |
| Google | `apps/backend/src/modules/google/webhooks/product-created.handler.ts:6,24,35` (and `product-updated`/`product-deleted` siblings) | Webhook handler validates payload, calls `queue.sendBatch(GOOGLE_QUEUE_NAMES.sync, [msg])` — **never blocks on GMC** (comment lines 13-15) |
| Google | `apps/backend/src/modules/google/gmc/google-product-sync.worker.ts:1-60+` | `GoogleProductSyncWorker`, `OnModuleInit`/`OnModuleDestroy`, gated by `GOOGLE_SYNC_WORKER_ENABLED`, `VISIBILITY` from `GOOGLE_SYNC_VISIBILITY` env (line 32) |
| Google | `apps/backend/src/modules/google/gmc/feed-sync.service.ts:51,79,120` | Distinguishes transient (rethrow → SQS redrive) vs permanent (4xx, ack) failures |
| Google | `apps/backend/src/modules/google/google.module.ts:96` | Module wiring comment: "Durable SQS queue (product webhooks enqueue; a worker drains it)" |
| Wizzy | `apps/backend/src/modules/wizzy/catalog/wizzy-sync.queue.ts:3` | `WIZZY` queue names, mirrors Google's shape exactly |
| Wizzy | `apps/backend/src/modules/wizzy/webhooks/product-created.handler.ts`, `product-deleted.handler.ts:10` | Same enqueue-then-return pattern as Google |
| Wizzy | `apps/backend/src/modules/wizzy/catalog/wizzy-sync.worker.ts:14,22` | Mirrors `GoogleProductSyncWorker` |
| Wizzy | `apps/backend/src/modules/wizzy/webhooks/webhooks.controller.ts:13` | Comment: "within 5 s per Ratio's spec — handlers enqueue to SQS and return fast" (the exact behavior CleverTap needs to adopt) |
| Wizzy | `apps/backend/src/modules/wizzy/wizzy.module.ts:84` | Module wiring comment |
| Loyalty | `apps/backend/src/modules/loyalty/bulk/loyalty-queues.ts:8-27` | Two queues: `loyalty-bulk-ops`, `loyalty-exports`; `LoyaltyBulkMessage { opId, merchantId, rowIds[] }` (≤500 rows/msg per line 14), `LoyaltyExportMessage` |
| Loyalty | `apps/backend/src/modules/loyalty/*/bulk.worker.ts` (TRD `apps/loyalty/TRD.md:75`) | Bulk-ops consumer, gated `LOYALTY_WORKER_ENABLED` |
| Loyalty | `apps/backend/src/modules/loyalty/*/exports.worker.ts` (TRD `:88`) | Streams CSV → S3, gated same flag |
| Forms | `apps/backend/src/modules/forms/delivery/webhook-delivery.queue.ts:14,23-31,34-36` | `FORMS_WEBHOOK_QUEUE_DEFAULT`, `queueNameFromEnv()` — accepts a **bare name OR a full SQS URL** from IaC and reduces it to the queue name (this URL-vs-name duality disappears entirely under Kafka, where topics are always bare names — a genuine simplification, see §9) |
| Forms | `apps/backend/src/modules/forms/delivery/email-notification.queue.ts:4` | Same pattern for the email queue |
| Forms | `apps/backend/src/modules/forms/submissions/export-job.queue.ts:2,6,17` | CSV export queue; comment: "the `form_export_jobs` row is the state; SQS is only the hand-off" — **the DB is the scheduler**, the queue is pure signaling (this exact posture is what CleverTap's design in §5 reuses) |
| Forms | `apps/backend/src/modules/forms/delivery/webhook-delivery.worker.ts:16`, `email.worker.ts:16`, `submissions/forms-export.worker.ts:20` | Three self-gated consumers (`FORMS_WEBHOOK_WORKER_ENABLED`, `FORMS_EMAIL_WORKER_ENABLED`, `FORMS_EXPORT_WORKER_ENABLED`) |
| Forms | `apps/backend/src/modules/forms/delivery/delivery-sweeper.service.ts:29` | A minute-cron **sweeper** claims due rows via conditional UPDATE and enqueues `{ deliveryId }` — decouples "when" (DB) from "how" (queue message) |
| Forms | `packages/shared/src/constants/forms-events.ts:35` | Retry-ladder comment: "SQS `DelaySeconds` caps at 15 min" — a real SQS API limit baked into forms' retry design that a Kafka migration must re-derive (no native per-message delay in Kafka; see §2.4) |
| core (test) | `apps/backend/test/unit/core/queue.service.test.ts:7-29` | Fakes `SQSClient.send` directly by swapping the private `client` field — the seam a Kafka fake-producer/consumer test double will replace (§7) |

**Not on a queue at all today:** PostHog, MoEngage (browser-side vendor
delivery only — `ARCHITECTURE.md:115-116`), RP/Return Prime (Mongo-backed,
no SQS references found), and **CleverTap** (fully synchronous — see §1.4).

### 1.3 How "workers" are modeled today

- Every consumer is a plain `@Injectable() ... implements OnModuleInit,
  OnModuleDestroy` class that self-gates on an env flag
  (`*_WORKER_ENABLED`) and runs its own `while (running) { receive; process;
  ack }` loop — there is no shared "Worker base class" or scheduler; each
  module hand-rolls this (`capi.worker.ts:34-75`,
  `google-product-sync.worker.ts:26-60+`).
- Placement is a first-class, recorded decision: `docs/agent/apps/<slug>/STATE.json`
  carries `deployment.apiPlacement` (`shared`|`dedicated`) and
  `deployment.workerPlacement` (`shared-api`|`dedicated-worker`|`none`)
  (`ARCHITECTURE.md:118-140`, `docs/agent/context/decisions/0005-...md:28-33`).
  Current recorded placements:

  | App | apiPlacement | workerPlacement |
  |---|---|---|
  | google | shared | **shared-api** |
  | wizzy | shared | **shared-api** |
  | loyalty | shared | **shared-api** |
  | meta | dedicated | **dedicated-worker** |
  | posthog | shared | none |
  | moengage | shared | none |
  | **clevertap** | shared | **none** ← the thing this change flips |

- Production topology is exactly 3 workloads today (`ARCHITECTURE.md:56-116`,
  `docs/DEPLOY.md:32-48`): shared API (Google/Wizzy/Loyalty/PostHog/MoEngage/
  Forms/CleverTap consumers embedded), Meta API, Meta worker
  (`main.worker.js`, `apps/backend/src/main.worker.ts:1-30`, gated by
  `META_WORKER_ENABLED`). `main.worker.ts:26` already logs an
  `ENABLED_QUEUES` env var that is **read but not schema-validated or acted
  on anywhere else** in the codebase (grep confirms zero other references) —
  effectively a stub for exactly the kind of per-workload queue-subset
  control Kafka consumer groups would need.
- Infra ownership is explicit and external: `docs/DEPLOY.md:1-9` states
  DevOps owns "VPC, EKS, ALB, ECR, RDS, ElastiCache, **SQS/DLQs**, IAM,
  secrets..." and this repo "does not invent local Kubernetes manifests."
  Any Kafka migration plan must respect the same boundary — this document
  proposes *what* to provision, not Terraform/Helm to provision it.

### 1.4 CleverTap inbound path today (the thing being made async)

Request flow, fully synchronous, one MySQL transaction, one process:

1. `POST /clevertap/api/v1/oauth/webhook` (and a legacy alias `POST
   /webhooks`) — `apps/backend/src/modules/clevertap/webhooks/webhooks.controller.ts:17-26`
   and `:36-45`. Guarded by `ClevertapWebhookSignatureGuard`
   (`webhooks.controller.ts:11,30`; guard factory at
   `apps/backend/src/core/webhooks/webhook-signature.guard.ts:38-83` — HMAC-SHA256
   over the raw body, header `x-ratio-hmac-sha256`).
2. Controller calls `this.webhooks.dispatch(envelope, deliveryId)` and
   returns `{ ok: true }` with `@HttpCode(200)` — **but `dispatch()` is
   awaited**, so the HTTP response does not return until the entire pipeline
   below finishes (`webhooks.controller.ts:24`).
3. `WebhooksService.dispatch()` — `apps/backend/src/core/webhooks/webhooks.service.ts:138-289`
   — opens **one MySQL transaction** that does: merchant lookup (with
   `FOR UPDATE` on the match path, line 186-193), `INSERT IGNORE INTO
   webhook_log` for inbound idempotency (line 209-220), and then, still
   inside the same transaction, **calls the matched handler** (line 277-281)
   before the final `UPDATE ... processed_at` (line 283-287).
4. For order topics the handler (e.g.
   `apps/backend/src/modules/clevertap/webhooks/order-created.handler.ts:15-21`)
   calls `ClevertapForwardingService.forwardOrder(...)`, which — **still
   inside the same open DB transaction** — does a config `SELECT`
   (`forwarding.service.ts:181-186`), an `INSERT IGNORE INTO
   clevertap_forwarded_events` as an outbound idempotency guard
   (`forwarding.service.ts:210-226`, `record()` at :265-282), decrypts the
   CleverTap Passcode, and **makes a real outbound HTTPS call** to
   CleverTap's public Events API (`forwarding.service.ts:229-236`), then an
   `UPDATE` on `clevertap_forwarded_events` with the result
   (`forwarding.service.ts:245-253`).

This means: **a burst of inbound webhooks holds MySQL transactions open for
the duration of an external HTTP call to CleverTap**, one per request, with
no queue in between. That is precisely the bottleneck named in the task
brief — a burst of concurrent webhooks (order storms, bulk product edits)
directly translates into concurrent open transactions + concurrent
synchronous outbound HTTP calls, competing for the same MySQL connection
pool budgeted at `DB_POOL_SIZE` (`docs/DEPLOY.md:89`, `.env.example:16-18`).

Outbound idempotency already exists and must be preserved exactly:
`clevertap_forwarded_events` has `UNIQUE(merchant_id, idempotency_key)`
(`apps/backend/src/modules/clevertap/db/migrations/0001_initial.ts:104-109`),
where `idempotencyKey = buildIdempotencyKey(topic, subjectId)` — this is the
mechanism §5 reuses to make Kafka's at-least-once delivery safe.

The delivery-health dashboard (already shipped,
`docs/agent/apps/clevertap/STATE.json:74`) reads straight off this table:
`GET /clevertap/api/status/deliveries` →
`config.controller.ts:63-65` → `ClevertapConfigService.getDeliveryHealth()`
(`config.service.ts:187-260`) computing 24h sent/failed/skipped counts,
per-topic breakdown, and the 10 most recent failures. **This dashboard needs
no schema change** under the new design (§5.6) — only a new "queued"/"in
flight" state needs a place to be visible.

`clevertap.module.ts:66-170` wires 15 webhook handler classes
(`handlerClasses` array, lines 141-157) through
`createAppProviders<ClevertapDatabase>(...)` — the same factory every module
uses (`core/factories/app-module.factory.ts`, referenced at
`clevertap.module.ts:4,136`).

**Confirmed: no Kafka client library exists anywhere in this repo today.**
`grep -rn kafka` across all TypeScript/JSON/YAML hits exactly one comment —
`apps/backend/src/modules/meta/capi/capi.service.ts:81`: *"The TRD's 20M/day
path adds a Kafka buffer + worker pool in front of this same dispatch logic
(M3/M7)"* — i.e. Kafka was already anticipated for Meta's own future scale,
independent of this change, but never built. `pnpm-lock.yaml` has zero
`kafkajs`/`node-rdkafka`/`@confluentinc/kafka-javascript` entries. The
`sandbox.os.ecosystem.customer.events` / `groupId: webhook.customers` names
referenced in `docs/agent/apps/clevertap/TODO.md:25` are **the upstream
Ratio/os-ecosystem platform's own internal Kafka topic**, used by Ratio to
route `customers/*` webhook deliveries to this app over HTTP — it is not
something this repo's backend consumes as a Kafka client, and gives no
constraint on the topic naming this plan proposes below (they are unrelated
systems).

### 1.5 Infra today

- `docker-compose.yml:38-49` — `elasticmq` service (SQS-compatible),
  `SQS_ENDPOINT: http://elasticmq:9324` injected into the `backend` service
  (`docker-compose.yml:85`).
- `.env.example:26-27` — local `AWS_REGION`, `SQS_ENDPOINT`.
- `.env.example:73-81,98-105,140-142,155-161,172-192` — every worker's env
  contract (`GOOGLE_SYNC_WORKER_ENABLED`/`_VISIBILITY`,
  `META_WORKER_ENABLED`/`_CAPI_BATCH_SIZE`/`_BATCH_WINDOW_MS`/`_VISIBILITY`/
  `_POLL_WAIT_SECONDS`, `WIZZY_SYNC_WORKER_ENABLED`/`_VISIBILITY`,
  `LOYALTY_WORKER_ENABLED`/`_BULK_CONCURRENCY`/`_BULK_VISIBILITY`,
  `FORMS_*_WORKER_ENABLED` ×3 + `FORMS_*_QUEUE_URL` ×3).
- `apps/backend/src/config/env.schema.ts:64-69,71-83,126-138` — these worker
  flags are schema-validated as `z.enum(['true','false'])`; queue *names* are
  **not** schema-validated (they're module-local constants or raw
  `process.env` string reads), which simplifies the Kafka env swap (§4.2).
- `docs/DEPLOY.md:216-238` — production SQS/DLQ provisioning table
  (`google-product-sync`↔`-dlq`, `meta-capi`↔`-dlq`,
  `wizzy-product-sync`↔`-dlq`) and IAM least-privilege split
  (`docs/DEPLOY.md:147-159`).
- `ARCHITECTURE.md:26-51` — the production topology Mermaid diagram, with
  `sqs["SQS queues + DLQs"]` as a shared node feeding both the shared API and
  the Meta worker.
- No Kafka broker in `docker-compose.yml` or anywhere in the repo today.

---

## 2. Target architecture

### 2.1 Principle

Ship a Kafka-backed module at `apps/backend/src/core/queue/` that preserves
the **existing method names and call shapes** (`sendBatch`/`receive`/`ack`,
or a thin adapter that keeps those names) so every existing call site above
changes by import path and (in a few cases) a delivery-semantics adjustment,
never by rewriting business logic. Concretely:

- `sendBatch(topic, payloads[])` → Kafka producer, one topic per current
  "queue name," partitioned by an explicit key (a required behavior change —
  see §2.3 — because SQS batches have no partition key concept).
- `receive(topic, groupId, max, waitMs)` → Kafka consumer `poll()`,
  returning the same `{ body, receiptHandle }[]` shape, where
  `receiptHandle` becomes an opaque token encoding `{topic, partition,
  offset}` so `ack()` keeps its existing signature.
- `ack(topic, receiptHandles[])` → commits the corresponding offsets (see
  §2.4 for why this needs care — Kafka commits are **cumulative per
  partition**, not per-message, unlike SQS's per-message delete).

### 2.2 Why per-app topics, not one shared topic

Mirror today's 1:1 "one SQS queue name per pipeline" model as 1:1 Kafka
topics — do **not** collapse everything onto one giant topic. Reasons:
independent retention/partition-count tuning per workload (Meta CAPI is
high-volume/high-throughput; Loyalty exports are low-volume/large-payload);
independent consumer-group scaling; blast-radius isolation (a poison message
or slow consumer on one topic must not starve another app, matching the
current per-queue DLQ isolation in `docs/DEPLOY.md:220-224`); and it keeps
the migration mechanical — each existing `QUEUE_NAMES` constant becomes a
topic name with the same string value, so no cross-app renegotiation is
needed.

Proposed topic map (mirrors §1.2 1:1):

| Existing SQS queue | New Kafka topic | Partitions (initial) | Key |
|---|---|---|---|
| `google-product-sync` (+ `-dlq`) | `google.product-sync` (+ `.dlq`) | 6 | `merchantId:productId` |
| `wizzy-product-sync` (+ `-dlq`) | `wizzy.product-sync` (+ `.dlq`) | 6 | `merchantId:productId` |
| `meta-capi` (+ `-dlq`) | `meta.capi` (+ `.dlq`) | 12 (highest volume — `capi.service.ts:79-82` already anticipated Kafka here at 20M/day) | `merchantId` (preserves the existing per-merchant buffering in `capi.worker.ts:77-83`) |
| `loyalty-bulk-ops` | `loyalty.bulk-ops` | 6 | `merchantId:opId` |
| `loyalty-exports` | `loyalty.exports` | 3 | `merchantId` |
| `forms-webhook-delivery` (default name, `webhook-delivery.queue.ts:14`) | `forms.webhook-delivery` | 6 | `deliveryId` |
| `forms-email-notification` | `forms.email-notification` | 3 | none needed (fire-and-forget, order-independent) |
| `forms-export` | `forms.export` | 3 | `exportId` |
| *(new)* CleverTap forwarding | `clevertap.forwarding` (+ `clevertap.forwarding.dlq`) | 6 | `merchantId` (§5.3) |

Dot-separated `app.purpose` naming (vs. today's hyphenated SQS names) is a
deliberate, low-risk rename opportunity taken at migration time since every
name is already a module-local constant, not a schema-validated env value —
grep confirms no test or env schema hardcodes the old hyphenated string as a
contract (only `queue.service.test.ts` uses a placeholder `'q'`/`'some-other-queue'`).
Keeping the old strings verbatim instead is equally valid if the team prefers
zero renames; either way the mapping is 1:1 and mechanical.

### 2.3 Ordering: per-key partitioning replaces SQS's (lack of) ordering

SQS standard queues (used here — no FIFO queue name suffix `.fifo` anywhere)
give **no ordering guarantee** today; the app already works around this by
design (e.g. Google's worker fetches the *current* authoritative product by
id rather than trusting message order — `google-product-sync.queue.ts:9-15`
comment: "the worker fetches the authoritative product by id and decides
sync-vs-remove"). Kafka's per-partition ordering is strictly stronger than
what exists today, so no app *loses* ordering; some *gain* it as a bonus
consistency property, which callers may exploit later but don't need to.

For CleverTap specifically, partition key = `merchantId` (not
`merchantId:orderId`) so that all forwarding events for one merchant are
processed in delivery order on one partition, which matters when e.g.
`orders/create` and `orders/paid` land for the same order in quick
succession and a stale-write could otherwise race (§5.3).

### 2.4 Delivery semantics: at-least-once + idempotency (unchanged posture)

Kafka, like SQS here, is **at-least-once**, never exactly-once, across a
network+process boundary this app doesn't control end-to-end (Kafka's
"exactly-once" transactional API only guarantees exactly-once *within*
Kafka-to-Kafka pipelines; it cannot make the CleverTap HTTPS call
exactly-once). This is not a regression — the apps already assume
at-least-once and build idempotency at the data layer:

- CleverTap: `UNIQUE(merchant_id, idempotency_key)` on
  `clevertap_forwarded_events` (§1.4) — reused verbatim.
- Forms: the DB row (`form_webhook_deliveries` /
  `form_export_jobs`) is the source of truth; the queue message is disposable
  signaling (`export-job.queue.ts:6`, `webhook-delivery.queue.ts:9-10`) —
  this pattern needs zero changes.
- Google/Wizzy: fetch-by-id-at-consume-time makes duplicate/reordered
  messages naturally idempotent (§2.3).
- Meta: Graph API dedupes on `event_id` per
  `capi.worker.ts:96` comment ("Meta dedupes on event_id") — unaffected.
- Loyalty: bulk ops keyed by `opId`+`rowNo` per
  `docs/agent/apps/loyalty/STATE.json` notes — unaffected.

One real semantic gap to close: **SQS's per-message `DelaySeconds` (used by
Forms' retry ladder, `forms-events.ts:35`, capped at 15 min) has no Kafka
equivalent** — Kafka has no native per-message delay. Forms already works
around the *same* SQS limitation today by keeping the DB as the scheduler
(a cron sweeper decides "when," `delivery-sweeper.service.ts:29`) and only
using the queue for the immediate "go do it now" signal — so this actually
requires **zero change** for Forms. Call this out explicitly so nobody
tries to invent Kafka message delay.

### 2.5 Backpressure

- **Producer side:** Kafka's `acks` setting plus a bounded in-flight request
  count naturally backpressures producers when the broker is slow — the
  producer's `send()` call will block/reject rather than silently
  succeeding, which is a *stronger* guarantee than SQS's effectively
  unbounded queue depth. For CleverTap's webhook path specifically (§5),
  producer backpressure must **not** propagate into a slow/failing webhook
  HTTP response — see §5.2's fire-and-forget-with-bounded-retry design.
- **Consumer side:** consumer-side backpressure is `max.poll.records` +
  processing time per batch, same shape as SQS's `MaxNumberOfMessages` +
  `WaitTimeSeconds` (`queue.service.ts:91-102`) — each existing worker's
  `receive(name, max, waitSeconds, visibilityTimeout)` call maps to
  `consumer.poll()` with an equivalent max-records/timeout pair, no
  redesign needed per-worker.
- Consumer lag (Kafka's native "oldest unconsumed offset age" metric)
  replaces SQS's `ApproximateAgeOfOldestMessage` 1:1 for the alarms already
  specified in `docs/DEPLOY.md:334` and `ARCHITECTURE.md:230-231`.

### 2.6 Retries, poison messages, and dead-letter topics

Kafka has no native visibility-timeout/redrive mechanism (Kafka consumers
`commit()` offsets; there is no "un-ack and it becomes visible again" —
uncommitted just means "will be re-delivered from last committed offset on
rebalance/restart," which is coarser than SQS's per-message redelivery).
This is the single largest architectural adjustment the migration must make
explicit in every worker, not paper over:

- Each worker keeps a **per-message retry counter carried in the message
  envelope** (`{ ...payload, attempt: number }`), since Kafka won't track
  per-message receive-count the way SQS's redrive policy does natively.
- After `maxAttempts` (mirror each queue's current effective SQS
  `maxReceiveCount`), the worker explicitly **produces the poison message to
  its `.dlq` topic** and commits the original offset — i.e., DLQ routing
  becomes **application code**, not infrastructure-configured redrive.  This
  is a real behavior change from today's "SQS redrive policy handles it,
  the app just doesn't ack" posture (`docs/DEPLOY.md:236-238`: "Workers
  acknowledge only successful operations... the unacknowledged message
  safely redelivers"). Budget this as new, testable code per worker (§7).
- The one existing behavior with no clean Kafka analogue: `queue.service.ts:104-112`
  silently **drops** an undecodable JSON body ("it will hit the redrive
  policy" — but it can't redeliver something never acked-away in SQS terms).
  Under Kafka, an unparseable message must still be explicitly routed to the
  DLQ topic (with a `reason: 'unparseable'` marker) rather than silently
  skipped, since Kafka has no equivalent silent-drop-and-move-on for the
  next message — the offset must be committed *somewhere* to make forward
  progress, and paper-trail it in the DLQ so nothing vanishes unexplained.

---

## 3. Shared-layer change (`packages/shared` + `core/queue`)

### 3.1 Where the code lives

- Keep the **runtime client** in `apps/backend/src/core/queue/` (mirrors
  today's placement — it needs NestJS DI, `ConfigService`, ambient
  `process.env`, none of which belongs in the framework-agnostic
  `packages/shared`).
- Add **pure, cross-app-shareable pieces** to `packages/shared/src/` — this
  is the actual "shared layer" the task brief means, and is genuinely new
  surface area today's SQS design didn't need shared constants for:
  - `packages/shared/src/constants/kafka-topics.ts` — the topic-name map
    from §2.2 as typed constants (`GOOGLE_PRODUCT_SYNC_TOPIC`,
    `CLEVERTAP_FORWARDING_TOPIC`, etc.), analogous to the existing
    per-vendor `*-events.ts` files in that directory
    (`packages/shared/src/constants/google-events.ts`,
    `clevertap-events.ts`, etc. — see `ls` output: 10 files, one per
    vendor/purpose).
  - `packages/shared/src/schemas/queue-envelope.ts` — a zod schema for the
    common envelope shape `{ attempt, enqueuedAt, payload }` used by every
    producer, so the "attempt counter" behavior in §2.6 is enforced by a
    shared type, not reinvented per app (mirrors how
    `webhookEnvelopeSchema` already centralizes the inbound webhook
    contract in `apps/backend/src/core/webhooks/webhooks.types.ts`).

### 3.2 The new interface (keeps existing call shape)

```ts
// apps/backend/src/core/queue/kafka-queue.service.ts (new)
export interface ReceivedMessage<T = unknown> {
  body: T;
  receiptHandle: string; // opaque: base64({ topic, partition, offset })
}

@Injectable()
export class KafkaQueueService implements OnModuleDestroy {
  async sendBatch(topic: string, payloads: unknown[], key?: (p: unknown) => string): Promise<void>;
  async receive<T = unknown>(topic: string, groupId: string, max?: number, waitMs?: number): Promise<ReceivedMessage<T>[]>;
  async ack(topic: string, receiptHandles: string[]): Promise<void>; // commits offsets
  async sendToDlq(topic: string, payload: unknown, reason: string): Promise<void>; // NEW — see §2.6
  async onModuleDestroy(): Promise<void>; // graceful shutdown, see below
}
```

Two deliberate deviations from a byte-for-byte-identical signature, both
required by Kafka's model and both isolated to call sites that already
differ per-app:

1. **`receive` gains a `groupId` parameter.** SQS queues have no concept of
   independent consumer groups (all consumers of a queue compete for the
   same messages); Kafka requires an explicit group id per logical consumer.
   Each app already has a natural group id — the queue name itself
   (`google-product-sync`, `clevertap-forwarding`) — so this is a one-line
   addition at each of the ~6 call sites in §1.2, not a redesign.
2. **`sendBatch` gains an optional partition-key function.** Only matters
   for apps that need ordering (§2.3); apps that don't care pass nothing and
   get round-robin partitioning, which is behaviorally identical to SQS
   standard queues' lack of ordering.

`sendBatch`/`ack`'s **chunking behavior** (queue.service.ts:69-80,
`DeleteMessageBatchCommand` 10-per-call) has no Kafka equivalent requirement
— Kafka producers/consumers batch internally and far more efficiently — so
that chunking loop is deleted, not ported, in the new implementation. This
is a pure simplification with no caller-visible effect (callers still pass
an unbounded array).

### 3.3 Config / env keys

New, alongside (not replacing, during the dual-run window — §6) the existing
`SQS_ENDPOINT`/`AWS_REGION`:

```
KAFKA_BROKERS=localhost:9092                # comma-separated, mirrors REDIS_URL-style single key
KAFKA_CLIENT_ID=ratio-apps-backend           # per-workload override optional
KAFKA_SSL=false                              # true in prod (managed Kafka / MSK / Confluent)
KAFKA_SASL_MECHANISM=                        # unset locally; e.g. 'scram-sha-512' in prod
KAFKA_SASL_USERNAME=
KAFKA_SASL_PASSWORD=
KAFKA_CONNECTION_TIMEOUT_MS=10000
KAFKA_QUEUE_BACKEND=sqs|kafka                # NEW per-app or global cutover flag, see §4/§6
```

Schema addition mirrors the existing pattern in `env.schema.ts:15-152` —
add these to `baseEnv` (they're cross-app, like `REDIS_URL`), not
per-`RATIO_<APP>_*` blocks, since one Kafka cluster serves every app (same
posture as the single shared Redis today, `.env.example:28`).

### 3.4 Producer vs. consumer processes

No topology change is required at the shared-layer level: exactly like
today, a producer is just "a NestJS provider that calls `sendBatch()`" (no
special process), and a consumer is "a class implementing `OnModuleInit`
that runs a poll loop" (`capi.worker.ts:34-75` pattern, unchanged). Kafka
consumer groups make the *existing* "shared-api replicas are also
consumers" pattern (`ARCHITECTURE.md:74-78`) work more precisely than SQS
did: SQS gave every replica a fair chance at every message; Kafka's
consumer-group rebalancing gives each replica an explicit, non-overlapping
partition subset — strictly better isolation for the "N shared-API replicas
all run the Google consumer" scenario already in production.

### 3.5 Graceful shutdown

Kafka clients need an explicit `consumer.disconnect()` for a clean
rebalance (SQS needed none — polling just stops). Wire this into
`OnModuleDestroy` in the shared `KafkaQueueService` (unlike the ad-hoc
`running = false` flags each worker manages today, e.g.
`google-product-sync.worker.ts` `onModuleDestroy` stub referenced in its
header comment) and additionally keep each worker's own `running` flag for
loop exit, matching `main.worker.ts:19`'s existing comment: *"`enableShutdownHooks`
+ each worker's onModuleDestroy give a clean SIGTERM drain."* No change to
that sentence's intent — only to which client type is being drained.

---

## 4. Per-app migration steps (ordered, independently shippable)

General rule for every app below: **flag-gated, dual-implementation, one PR
per app**, so any single app can roll back to SQS independently without
touching the others (the shared abstraction, not each app, decides SQS vs.
Kafka).

### 4.0 Sequencing rationale

Order by *ascending blast radius* and *ascending volume*, so the riskiest
(highest-volume, ordering-sensitive) app — Meta — migrates last, once the
pattern is proven on lower-stakes traffic:

1. **Loyalty** (lowest volume, already fully idempotent by design, `bulk.worker.ts`/`exports.worker.ts` are simple)
2. **Forms** (three queues, but each is DB-scheduler-driven — the queue is genuinely disposable signaling, easiest to reason about)
3. **Wizzy**
4. **Google** (same shape as Wizzy, do second to catch shared bugs cheaply)
5. **Meta** (highest volume, most latency-sensitive, dedicated worker deployment — migrate once confidence is high)
6. **CleverTap** — built **directly on Kafka**, no migration needed (§5); can happen at any point in this sequence, even first, since it has no legacy SQS call sites to preserve compatibility with.

### 4.1 Per-app steps (template, applied to each of Loyalty/Forms/Wizzy/Google/Meta)

1. Add the new topic(s) to `packages/shared/src/constants/kafka-topics.ts`
   with the same logical name as the existing `QUEUE_NAMES` constant
   (§2.2 table).
2. Add a `KAFKA_QUEUE_BACKEND` (or a narrower per-app flag, e.g.
   `LOYALTY_QUEUE_BACKEND=sqs|kafka`) env key, defaulting to `sqs`, read at
   the module's provider-factory boundary (the exact place each module
   already picks its `QueueService`, e.g. `loyalty.module.ts`'s providers
   array) — inject `KafkaQueueService` instead of the SQS `QueueService`
   when the flag is `kafka`. Because both implementations share the
   `sendBatch/receive/ack` shape, **handler and worker code does not
   change** — only the DI wiring line changes.
3. Provision the mirrored Kafka topic in the target environment (§6 —
   local docker-compose first, then staging, then prod) alongside the
   existing SQS queue — do not remove the SQS queue yet.
4. Flip the flag in **one non-prod environment**, run the existing test
   suite for that module plus a manual soak (send N webhooks, verify the
   worker drains via Kafka not SQS, verify the DLQ topic receives an
   intentionally-poisoned message).
5. Flip the flag in production for that app only. Watch consumer lag,
   error rate, DLQ topic depth for an agreed bake period (recommend: one
   full daily traffic cycle, since Forms/Loyalty exports and Meta CAPI both
   have daily volume patterns per their batch-window designs).
6. Once stable, delete the SQS queue + its provisioning entry from
   `docs/DEPLOY.md`'s table (§1.5) and drop the dead SQS code path for that
   app's queue-name file.
7. After all 5 apps have cut over, delete `core/queue/queue.service.ts`
   (the SQS implementation) and the `@aws-sdk/client-sqs` dependency from
   `apps/backend/package.json:20`, and remove `elasticmq` from
   `docker-compose.yml:38-49`.

### 4.2 App-specific notes

- **Meta** (`capi.worker.ts`): the buffering-by-merchant logic (lines
  77-116) is unaffected — it operates on the `{body, receiptHandle}[]`
  return shape regardless of backend. The one Meta-specific risk: `WAIT_SECONDS`
  is clamped to SQS's 0–20s max poll (`capi.worker.ts:46`) — Kafka's
  `consumer.poll()` timeout has no such 20s ceiling, so this specific
  constant can be relaxed, but leave it as-is during migration to keep the
  behavior change surface minimal; revisit post-migration as a follow-up
  tuning task, not part of this cutover.
- **Google/Wizzy**: identical shape; migrate together or Google-first as the
  more heavily-referenced pattern (its comments are the ones other modules'
  code cites, e.g. `webhook-delivery.worker.ts:16`: "mirroring the
  google-product-sync precedent").
- **Loyalty**: two independent queues (`bulk-ops`, `exports`) can migrate on
  independent schedules since they're unrelated workloads sharing only the
  `LOYALTY_WORKER_ENABLED` flag today (`loyalty-queues.ts:8-11`) — consider
  splitting into `LOYALTY_BULK_QUEUE_BACKEND` / `LOYALTY_EXPORT_QUEUE_BACKEND`
  if the team wants finer rollback granularity, else one flag is fine given
  low volume.
- **Forms**: three queues; the `queueNameFromEnv()` URL-reduction helper
  (`webhook-delivery.queue.ts:23-31`) becomes dead code post-migration since
  Kafka topics are never expressed as a "queue URL" — delete it, don't port
  it, once Forms fully cuts over.

### 4.3 Compatibility / dual-run strategy

The flag-per-app approach above **is** the dual-run strategy — there is no
need for a fancier "dual-write both backends simultaneously" scheme, because
every consumer already tolerates at-least-once/out-of-order delivery (§2.4),
so cutting a single app from SQS to Kafka atomically (stop producing to SQS,
start producing to Kafka, for that app, at a single deploy) is safe as long
as: (a) the in-flight SQS messages at cutover time are drained by the old
worker before it's decommissioned (a brief grace period, worker keeps
running against SQS post-flag-flip until its queue is empty — verify via
the existing `ApproximateNumberOfMessages` CloudWatch metric hitting zero),
and (b) the new Kafka worker only starts consuming after that drain
confirms empty. This avoids running two live consumers of overlapping work
for any app, which would require idempotency across *both* systems
simultaneously — unnecessary complexity given every consumer is already
idempotent against retries within one system.

---

## 5. CleverTap webhook-queue design

### 5.1 Goal restated

Today: `POST /clevertap/api/v1/oauth/webhook` → signature verify → open
MySQL transaction → inbound dedupe insert → **run the handler inline,
including the outbound HTTPS call to CleverTap** → commit → 200 (§1.4).
Target: accept fast, forward later, off the request path, so a burst of N
simultaneous webhooks costs N fast DB inserts, not N held-open transactions
racing N synchronous outbound HTTPS calls.

### 5.2 New request path

1. `ClevertapWebhookSignatureGuard` unchanged — signature verification stays
   synchronous and on the request path (it's cheap, in-memory HMAC, no I/O;
   `webhook-signature.guard.ts:73-79`) and must reject bad signatures before
   we ever touch Kafka or MySQL.
2. `WebhooksService.dispatch()` (`core/webhooks/webhooks.service.ts`) is
   **shared across every app**, not CleverTap-only — changing its
   transactional semantics is core-layer, feature-tier work by this repo's
   own convention (the same boundary the CleverTap TODO already respects:
   "touches `core/` and is therefore feature-tier work, deliberately not
   made from inside this module," `docs/agent/apps/clevertap/TODO.md:81-82`).
   So the design does **not** change `WebhooksService.dispatch()` itself.
   Instead, CleverTap's handlers change what they do *inside* the existing
   transaction: instead of calling
   `ClevertapForwardingService.forward()` synchronously (today's
   `order-created.handler.ts:20`), each handler:
   a. Still runs inside the existing inbound-dedupe transaction (so
      `webhook_log`'s idempotency guarantee is untouched — no regression on
      inbound dedupe).
   b. Inserts the `clevertap_forwarded_events` row with
      `status: 'queued'` (a **new status value**, alongside today's
      `'sent'|'failed'|'skipped'`) instead of `'failed'`-then-`'sent'`
      (replaces `forwarding.service.ts:210-217`'s "insert as failed,
      in-flight" placeholder row).
   c. After the transaction commits (Nest lifecycle: enqueue in the
      handler's return, executed synchronously but with **no network I/O**,
      just a Kafka `send()` which is fire-and-forget from the handler's
      perspective — see below for why this is still safe), produces one
      Kafka message to `clevertap.forwarding` keyed by `merchantId`.
3. Controller returns `{ ok: true }` as soon as the transaction (now
   containing no outbound HTTP call) commits — this is the entire latency
   win. The webhook's total handling time drops from
   "DB round trips + CleverTap API latency" to "DB round trips + one Kafka
   produce," and Kafka produces are milliseconds, not the CleverTap API's
   potentially multi-hundred-ms external call.

**Why enqueue *after* the DB transaction commits, not from inside it:**
Kafka has no transactional co-commit with MySQL in this codebase (no XA/2PC,
and adding one would be a large, unjustified complexity increase for this
use case). So there is a narrow window where the DB commit succeeds but the
process crashes before the Kafka produce — this would silently strand a
`'queued'` row forever. Mitigate with the existing self-healing pattern
already used in this codebase: a **periodic reconciliation sweep** (same
shape as Forms' `delivery-sweeper.service.ts:29`) that re-enqueues any
`clevertap_forwarded_events` row with `status='queued'` older than N minutes
— this also becomes the natural retry path for a message that Kafka
accepted but was never actually processed (broker/consumer never actually
saw it due to some edge case), giving CleverTap the same "DB is the
scheduler, queue is just a signal" posture Forms already uses
(§2.4/§4.1's app template item 3's underlying philosophy).

### 5.3 Kafka consumer / worker

New `ClevertapForwardingWorker`, structurally identical to
`GoogleProductSyncWorker` (`google-product-sync.worker.ts`):

- `OnModuleInit`, gated by a new `CLEVERTAP_FORWARD_WORKER_ENABLED` flag
  (mirrors `GOOGLE_SYNC_WORKER_ENABLED` naming convention,
  `env.schema.ts:69`).
- Consumer group `clevertap-forwarding`, topic `clevertap.forwarding`
  (§2.2), partitioned by `merchantId` so all of one merchant's events
  process in delivery order — important because `orders/create` then
  `orders/paid` for the same order, processed out of order, could otherwise
  land the `Charged` event before the customer-profile-establishing
  `orders/create` mapping runs (today's synchronous-inline design has no
  such risk since everything is already serialized per request; Kafka
  reintroduces a version of the ordering question that per-merchant
  partitioning resolves).
- Per message: re-derive `mapped = mapOrderEvent(topic, order)` (or the
  loyalty/review/customer equivalent — same mapper functions,
  `order-event.mapper.ts`, `review-event.mapper.ts`,
  `loyalty-event.mapper.ts`, entirely unchanged), then call
  `ClevertapForwardingService.forward()` — but note `forward()` today takes
  a `trx: WebhookTrx` parameter (`forwarding.service.ts:163-176`) because it
  reads config and writes status **inside the inbound webhook's
  transaction**. The worker has no such transaction (it's not inside a
  webhook request) — so `forward()` needs a **non-transactional variant**
  that opens its own short transaction scoped just to
  "read config → call CleverTap → update status," identical statements,
  different transaction boundary. This is the one genuine code change to
  `forwarding.service.ts`, and it is additive (new method /
  overload), not a rewrite — the mapping, idempotency-key derivation
  (`buildIdempotencyKey`), and skip-reason logic (`skipReasonFor()`,
  `forwarding.service.ts:285-305`) are reused verbatim.
- Idempotency: **`clevertap_forwarded_events` UNIQUE(merchant_id,
  idempotency_key)` is reused exactly as-is** — this is precisely why the
  existing schema already tolerates Kafka's at-least-once redelivery with
  zero migration: a redelivered message hits the same unique key, the
  `INSERT IGNORE` (`forwarding.service.ts:276-281`) reports `0` rows
  affected, and the worker treats that as "already handled, skip the
  outbound call" — the exact "duplicate forward suppressed" branch that
  already exists (`forwarding.service.ts:218-226`).
- Poison messages: after `maxAttempts` (recommend 5, configurable via
  `CLEVERTAP_FORWARD_MAX_ATTEMPTS`), route to `clevertap.forwarding.dlq`
  with the accumulated error and mark the `clevertap_forwarded_events` row
  `status='failed'` (an existing status value — no dashboard change needed,
  §5.6) rather than leaving it `'queued'` forever. This preserves the
  existing invariant that every row eventually reaches a terminal
  `sent|failed|skipped` state, just with one new intermediate `queued`
  state visible only while in flight.

### 5.4 Ordering per merchant/order

Addressed above (§5.3): partition key `merchantId`, not per-order, so a
single merchant's events serialize through one partition/consumer instance
while different merchants parallelize freely across partitions — this
matches the existing per-merchant isolation already present in
`MetaCapiWorker`'s buffering-by-merchant design (`capi.worker.ts:77-83`),
reusing a pattern this codebase has already proven at higher volume.

### 5.5 `workerPlacement`: none → worker

Per `ARCHITECTURE.md:118-140` and `docs/agent/apps/clevertap/STATE.json:64-65`,
CleverTap is currently `apiPlacement: shared`, `workerPlacement: none`. This
design requires flipping `workerPlacement` to **`shared-api`** (run the
Kafka consumer inside the existing shared-backend replicas, same posture as
Google/Wizzy/Loyalty today, `ARCHITECTURE.md:109-116`'s table) rather than
`dedicated-worker`, because CleverTap's current volume does not warrant an
isolated Deployment — same reasoning `docs/agent/context/decisions/0005-...md:38-51`
already gives for keeping Google/Wizzy embedded. Record this as a new ADR
(`docs/agent/context/decisions/000X-clevertap-worker-placement.md`) and
update `docs/agent/apps/clevertap/STATE.json`'s `deployment.workerPlacement`
field per this repo's own governance rule (`ARCHITECTURE.md:137`: "The PRD
workflow must ask for this decision" — this change is exactly the kind of
placement change that decision 0005 anticipates and allows via "a reviewed
architecture change," decision 0005's Consequences section, last bullet).
If/when CleverTap volume grows to Meta-like levels, the same
`dedicated-worker` escape hatch is available without another shared-layer
change.

### 5.6 Admin delivery-health dashboard while queued

No backend schema change is required (§5.2b already covers the new `queued`
status value living in the existing `status` column — `clevertap_forwarded_events.status`
is `varchar(16)`, migration `0001_initial.ts:92`, plenty of room for
`'queued'` alongside `'sent'|'failed'|'skipped'`). Two small additions to
`ClevertapConfigService.getDeliveryHealth()` (`config.service.ts:187-260`)
and the admin's `DeliveryHealthPanel`:

- Add a `queued` counter alongside today's `sent`/`failed`/`skipped` in the
  24h summary (`config.service.ts:198-201`'s tally loop gains one more
  branch) and in the per-topic breakdown (`:206-220`).
- Surface **queue depth / consumer lag** as a distinct, real-time metric
  (not from the MySQL table — from Kafka's consumer-group lag API) in a new
  small panel next to the historical 24h stats, since "how many events are
  sitting in the queue *right now*" is operationally different information
  from "what happened in the last 24 hours" and the existing dashboard only
  answers the latter. This is the one genuinely new piece of observability
  this feature needs — everything else reuses `clevertap_forwarded_events`
  as-is.
- `recentFailures` (`config.service.ts:237-244`, limit 10) is unaffected —
  a message that exhausts retries and lands in the DLQ still gets a
  `status='failed'` row with its final error, same shape merchants already
  see today.

---

## 6. Config, infra & local dev

### 6.1 `docker-compose.yml`

Add a Kafka broker service (recommend a single-node KRaft-mode image —
no separate ZooKeeper container needed on modern Kafka, keeping the compose
footprint comparable to today's single `elasticmq` container):

```yaml
kafka:
  image: apache/kafka:latest      # or confluentinc/cp-kafka / bitnami/kafka — pick per team's existing vendor familiarity
  container_name: ratio-app-kafka
  restart: unless-stopped
  ports:
    - "9092:9092"
  environment:
    KAFKA_NODE_ID: 1
    KAFKA_PROCESS_ROLES: broker,controller
    KAFKA_LISTENERS: PLAINTEXT://:9092,CONTROLLER://:9093
    KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://localhost:9092
    KAFKA_CONTROLLER_QUORUM_VOTERS: 1@localhost:9093
    KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
    KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"   # dev convenience only — see §6.3 for why prod disables this
```

Add it to `backend`'s `depends_on` (mirroring today's `elasticmq:
condition: service_started`, `docker-compose.yml:60-61`), and — during the
dual-run window only (§4.3) — keep `elasticmq` running side by side so
not-yet-migrated apps keep working unmodified. Remove `elasticmq` only after
§4.1 step 7 (all apps cut over).

### 6.2 `.env.example`

Add the §3.3 Kafka block near the existing `SQS_ENDPOINT`/`AWS_REGION` lines
(`.env.example:26-27`), with the same "host-side vs compose-override"
comment pattern already used there, and add per-app `*_QUEUE_BACKEND` keys
next to each app's existing worker block (e.g. right after
`GOOGLE_SYNC_WORKER_ENABLED` at `.env.example:80`, `WIZZY_SYNC_WORKER_ENABLED`
at `:140`, `LOYALTY_WORKER_ENABLED` at `:155`, the three `FORMS_*_WORKER_ENABLED`
at `:175-176,190`), plus the new `CLEVERTAP_FORWARD_WORKER_ENABLED` /
`CLEVERTAP_FORWARD_MAX_ATTEMPTS` keys next to CleverTap's existing
`CLEVERTAP_APP_ENABLED` (`.env.example:203`).

### 6.3 k8s / GitOps notes (description only — no manifests added here)

Per `docs/DEPLOY.md:1-9`'s explicit boundary ("DevOps owns... SQS/DLQs...
This repository does not invent local Kubernetes manifests"), this plan
follows the same convention for Kafka: it describes the contract, DevOps
provisions it.

- Provision a managed Kafka cluster (MSK, Confluent Cloud, or
  self-hosted-on-EKS per the team's existing AWS posture — this repo has no
  opinion beyond "give us `KAFKA_BROKERS` + SASL creds").
- **Disable topic auto-creation in every non-local environment**
  (`auto.create.topics.enable=false`) — auto-creation is a dev-only
  convenience; production topics must be explicitly provisioned with
  reviewed partition counts/retention (mirrors today's stance that SQS
  queues/DLQs are "infrastructure responsibilities," `README.md:114`).
  Provisioning is a one-time `kafka-topics.sh --create` (or Terraform
  `confluent_kafka_topic`/MSK equivalent) per topic in §2.2's table, run by
  DevOps as part of the release the way SQS queues are today.
- IAM/auth: SASL/SCRAM or mTLS credentials via AWS Secrets Manager + External
  Secrets, mirroring today's "no long-lived AWS keys in Kubernetes Secrets"
  rule (`docs/DEPLOY.md:159`) — same rule, different credential type
  (Kafka SASL user/pass or client cert, not an IAM policy, since Kafka auth
  isn't IAM-native unless using MSK IAM auth, which is also an option worth
  DevOps evaluating).
- Update `docs/DEPLOY.md`'s workload/env tables (`:32-48`, `:80-159`) once
  the cutover is real — this document should be treated as the source draft
  for those edits, not a replacement for keeping `DEPLOY.md` current.
- CleverTap's placement change (§5.5) needs the same
  `ENABLED_MODULES`/worker-flag update `docs/DEPLOY.md:291-324` describes
  for "Adding a future app" — append `CLEVERTAP_FORWARD_WORKER_ENABLED=true`
  to the shared backend's env profile (`docs/DEPLOY.md:119-121`'s block),
  no new Deployment.

---

## 7. Testing strategy

### 7.1 Unit — fake producer/consumer

Follow the exact pattern already proven for SQS
(`apps/backend/test/unit/core/queue.service.test.ts:15-29`): construct the
service, then replace its internal Kafka client with an in-memory fake
whose `send`/`consumer.run` are spies backed by an in-process array acting
as the "broker." Concretely:

- A `FakeKafkaClient` with an in-memory `Map<topic, Message[]>`, supporting
  `producer().send()` (push) and `consumer().subscribe()/run()` (pop, in
  offset order, honoring the requested `groupId` as an independent
  read-cursor per group — this is the one piece of new fake complexity vs.
  SQS's simpler "any consumer can dequeue any message" model).
- Reuse this fake across **every** migrated app's worker tests — a single
  shared test double in `apps/backend/test/helpers/fake-kafka.ts`, referenced
  the way `apps/backend/test/unit/apps/loyalty/helpers/fakes.ts:10` already
  documents its own philosophy: "SQS is an array" — literally the same
  approach, one level up in fidelity for partitions/groups.
- Port `queue.service.test.ts`'s existing assertions 1:1 (arbitrary topic
  name accepted, `receive` parses/drops bad JSON — though see §2.6, this
  behavior changes to DLQ-route instead of silently drop, so this specific
  test's expectation must update, not just its imports).

### 7.2 Integration

- Local: run the real `docker-compose` Kafka service (§6.1) in CI, produce
  a real message, run the real worker against it, assert the DB side effect
  — mirrors however Google/Wizzy sync currently gets integration-tested
  against real ElasticMQ (or, if no such integration test currently exists
  for SQS — confirm during implementation — this would be new coverage
  worth adding for both backends).
- CleverTap-specific: a full round-trip test — POST the webhook, assert the
  `clevertap_forwarded_events` row is `status='queued'`, drive the fake/real
  Kafka message through the new `ClevertapForwardingWorker`, assert the row
  transitions to `'sent'` and the fake CleverTap Events API received the
  call exactly once even if the Kafka message is delivered twice (the core
  idempotency assertion — direct analogue of the existing
  `forwarding.service.test.ts` "duplicate key = no second fetch" case noted
  in `docs/agent/apps/clevertap/STATE.json:109`).

### 7.3 Impact on existing CleverTap tests

- `forwarding.service.test.ts` (per STATE.json history, tests "insert-before-call,"
  "duplicate key = no second fetch," "CleverTap 5xx still resolves") —
  these assertions are **preserved**, just re-targeted: today they exercise
  `forward()` called synchronously from a handler-under-test; after this
  change they exercise the same `forward()` logic called from the new
  non-transactional worker-facing method (§5.3) — the mapping/idempotency/
  skip-reason unit tests barely change, only the call harness around them.
- Handler tests (`order-created.handler.ts` etc.) currently assert the
  handler calls `forwarding.forwardOrder(...)` and awaits it inline — after
  this change they assert the handler writes a `'queued'` row and calls
  `queue.sendBatch('clevertap.forwarding', [...])` instead — a small,
  mechanical update to each of the ~9 order/loyalty/review handler tests
  (topics.test.ts's exhaustive topic-set assertion, per STATE.json:109,
  remains a useful guard that nothing gets silently un-wired during this
  refactor).
- New tests needed: the `ClevertapForwardingWorker` itself (poison-message
  → DLQ after max attempts; ordering-per-merchant via partition key;
  reconciliation sweep re-enqueues stale `'queued'` rows).
- No admin-clevertap test changes beyond the `DeliveryHealthPanel`'s new
  `queued` counter / lag panel (§5.6).

---

## 8. Rollout & rollback

### 8.1 Phased plan

| Phase | Scope | Flag | Rollback |
|---|---|---|---|
| 0 | Ship `KafkaQueueService` + fakes, inert (no app wired yet) | n/a | delete the module, zero blast radius |
| 1 | Local docker-compose Kafka + one app (Loyalty) behind `LOYALTY_QUEUE_BACKEND` | per-app | flip flag back to `sqs`; SQS queue still exists and provisioned (§4.1 step 3 keeps it alive during this phase) |
| 2 | Staging cutover, Loyalty | same | same |
| 3 | Prod cutover, Loyalty, soak 1 cycle | same | same |
| 4–7 | Repeat phases 1–3 for Forms, Wizzy, Google, Meta in order (§4.0) | per-app | per-app |
| 8 | CleverTap: ship worker + Kafka topic + flip `workerPlacement`, gated by `CLEVERTAP_FORWARD_WORKER_ENABLED`, default **false** at first deploy | app-local | flag off ⇒ handlers fall back to today's synchronous inline `forward()` call (keep the old code path alive, dead-switch, until this flag is proven — do not delete `forward()`'s transactional call path until phase 9) |
| 9 | CleverTap flag on in prod, soak, then delete the now-dead synchronous inline call path and old `'failed'`-as-in-flight-placeholder status semantics (§5.2b) | — | revert the deploy (flag default was false; a rollback just means re-deploying with the flag off, no data migration needed since `clevertap_forwarded_events`'s schema is additive-only, §5.6) |
| 10 | Decommission SQS: drop `@aws-sdk/client-sqs`, `core/queue/queue.service.ts`, `elasticmq` from compose, SQS queues from `docs/DEPLOY.md` | — | (point of no return — only proceed once all apps + CleverTap have baked for an agreed period, e.g. 2+ weeks with zero SQS traffic observed) |

### 8.2 Metrics to watch during each app's soak window

- Kafka consumer lag per topic (new metric, replaces
  `ApproximateAgeOfOldestMessage`/`ApproximateNumberOfMessages` from
  `docs/DEPLOY.md:334`).
- DLQ topic depth (replaces SQS DLQ depth, same alarm philosophy).
- Per-app success/failure rate at the business-logic layer — unaffected by
  the transport swap, but a regression here is the strongest signal
  something in the migration broke semantics, not just plumbing (e.g. for
  CleverTap: `clevertap_forwarded_events` sent/failed ratio, visible
  directly on the existing dashboard, §5.6).
- MySQL pool saturation for CleverTap specifically — this should *drop*
  post-cutover since transactions no longer hold open across an outbound
  HTTP call; a lack of improvement here is a signal the new design isn't
  actually decoupling the request path as intended.
- P99 webhook response latency for CleverTap's `POST .../webhook` endpoint
  — the direct, user-facing metric this entire feature exists to improve;
  should drop from "DB + CleverTap API latency" to "DB + Kafka produce
  latency" (expect low-single-digit-ms improvement in produce time, but the
  real win is eliminating the *tail* — CleverTap API timeouts/slowness no
  longer show up in this endpoint's P99 at all).

### 8.3 Rollback mechanics

Every phase above is a **feature-flag flip**, never a data migration or a
one-way schema change, by design:

- SQS queues stay provisioned (not deleted) until the app's cutover has
  fully baked (§4.1 step 6) — rollback is "flip the flag, the old queue is
  still there and still has infra behind it."
- CleverTap's new `clevertap_forwarded_events.status='queued'` value is
  purely additive to an existing `varchar` column — no migration to revert.
- No dual-write of business data is ever required (§4.3) — only the
  transport (SQS vs. Kafka) is dual-run, and only one is "hot" for a given
  app/message at a time, so rollback never has to reconcile divergent
  state between two systems.

---

## 9. Risks & open questions

1. **Blast radius.** The shared `core/queue/` abstraction is consumed by
   6 apps today (Meta, Google, Wizzy, Loyalty, Forms ×3 queues) plus the new
   CleverTap consumer. A bug in the shared `KafkaQueueService` (e.g. an
   incorrect offset-commit boundary) risks **every** queue-backed app
   simultaneously once fully cut over — this is inherent to having a shared
   abstraction at all (true of the current SQS wrapper too) and is exactly
   why §4's per-app, flag-gated, sequenced rollout exists: no phase risks
   more than one app at a time until phase 10's final SQS removal, which
   should only happen after every app has independently proven stable.
2. **Ordering vs. throughput tradeoff.** More partitions ⇒ more
   parallelism but weaker per-key ordering guarantees if the partition
   count changes later (re-keying the same merchant to a different
   partition on a partition-count change is a known Kafka gotcha) — the
   partition counts in §2.2 are starting points, not final; changing them
   post-launch requires care (topic recreation or careful use of
   `kafka-reassign-partitions`, not simply raising a config number).
3. **"Exactly-once" is not on the table, and must be message to the team
   loudly.** No app in this codebase can honestly claim exactly-once
   delivery to its final external system (CleverTap's API, GMC, Wizzy,
   Meta's Graph API, SES) regardless of SQS or Kafka — idempotency at the
   data layer (§2.4) is what actually provides safety, and that doesn't
   change with this migration. Anyone proposing Kafka transactions as a
   path to "true exactly-once" for these external calls is solving the
   wrong problem — flag this explicitly in any design review.
4. **Poison-message handling is now application code, not infra
   configuration** (§2.6) — this is a net-new maintenance burden (every
   worker needs its own DLQ-routing logic + attempt-counter plumbing) that
   SQS's redrive policy gave for free. Consider factoring a shared
   "with-retry-and-dlq" wrapper in `core/queue/` once 2-3 workers have
   implemented this ad hoc, rather than letting each app reinvent it —
   flagged here as a likely follow-up refactor, not blocking the initial
   migration.
5. **Kafka operational ownership.** `docs/DEPLOY.md` is explicit that SQS/
   DLQ provisioning is a DevOps/infra responsibility outside this repo
   (§1.5, §6.3) — the same must be true for Kafka (cluster sizing, broker
   patching, partition rebalancing, consumer-group monitoring tooling).
   This is a **platform decision that needs sign-off before phase 1**:
   which managed Kafka offering, who owns on-call for broker health, and
   whether the existing DevOps team has Kafka operational experience or
   needs to build it. This plan assumes "yes, someone owns it" without
   being able to confirm that from repo contents alone.
6. **Local dev cost.** Kafka (even single-node KRaft mode) is a heavier
   local dependency than ElasticMQ's near-zero-footprint container
   (`docker-compose.yml:38-49`'s comment already notes ElasticMQ is "a
   minimal GraalVM binary"). Confirm the team's local dev machines/CI
   runners can comfortably run an added JVM-based broker alongside MySQL +
   Redis + the backend without resource contention, especially in CI where
   multiple test suites may run in parallel.
7. **`ENABLED_QUEUES` env var is currently a dead stub**
   (`main.worker.ts:26`, logged but never validated/consumed anywhere) —
   worth deciding during this migration whether to finally wire it up as
   the mechanism for "which Kafka consumer groups does this replica run"
   (a natural fit, since Kafka consumer groups are exactly the right
   granularity for this), or to remove the stub as unused. Flagging so it
   isn't accidentally load-bearing for something no one currently owns.
8. **CleverTap-specific open question: is `shared-api` placement
   sufficient at CleverTap's actual current traffic, or should it go
   straight to `dedicated-worker`?** The task brief frames the problem as
   "bursts of many simultaneous webhook requests" — if those bursts are
   large enough to matter at Meta's scale, CleverTap may warrant the same
   dedicated-worker isolation Meta has, skipping the shared-api
   intermediate step. This repo has no current traffic data for CleverTap
   (it isn't yet deployed to production per `STATE.json`'s
   `"deployTarget": null`, `"prUrl": null`) to make that call
   quantitatively — recommend starting `shared-api` (cheaper, matches
   Google/Wizzy/Loyalty precedent) and revisiting via decision 0005's
   documented escape hatch once real traffic is observed.
9. **Reconciliation-sweep frequency for stranded `'queued'` rows (§5.2)**
   is an open tuning question — too frequent and it adds needless DB load
   scanning for a rare crash-window edge case; too infrequent and a
   stranded webhook takes longer to actually reach CleverTap. Recommend
   starting at the same cadence as Forms' existing minute-sweeper
   (`delivery-sweeper.service.ts:29`) since that cadence is already proven
   acceptable in this codebase for a structurally identical problem.
