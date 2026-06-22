# Meta CAPI Pipeline — Operational Runbook

## Overview

The Meta CAPI pipeline ingests browser-to-server events from the storefront via the Conversions API (CAPI), batches and hashes PII, and dispatches to Meta Graph API with per-merchant rate limiting. The pipeline scales from SQS to Kinesis with a phased migration strategy.

**Key components:**
- **Ingestion edge** (`svc-meta-ingest`): validates and routes events per `META_CAPI_BUS` (sqs|kinesis|both).
- **Kinesis consumer** (`svc-meta-capi`): polls stream, checks shard leases (MySQL), batches, enforces rate limits, dispatches to Meta, checkpoints, and DLQs non-retryables.
- **SQS worker** (`MetaCapiWorker`): legacy path; accumulates events in per-merchant buffers, flushes on size or time.
- **Stats** (`capi-stats`): tracks sent/failed counts per merchant for parity verification.

---

## Phased Migration: SQS → Kinesis

### Phase 1: Baseline (SQS only)

**Mode:** `META_CAPI_BUS=sqs` (default)

- Ingestion → SQS `meta-capi` queue.
- `MetaCapiWorker` polls, buffers, flushes.
- **No Kinesis consumer active** (`META_CAPI_CONSUMER_ENABLED=false`).

**Validation:**
```sql
-- Example: count SQS messages processed in last 24h
SELECT merchant_id, COUNT(*) as events_sent, SUM(json_extract(result, '$.failed')) as events_failed
FROM capi_stats
WHERE created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
GROUP BY merchant_id;
```

---

### Phase 2: Dual-Write (SQS + Kinesis)

**Mode:** `META_CAPI_BUS=both` with `META_CAPI_CONSUMER_ENABLED=true`

**Steps:**
1. Deploy with `META_CAPI_BUS=both` and `META_CAPI_CONSUMER_ENABLED=true` to **staging** (or a canary environment).
2. Ingest events via the storefront — both SQS and Kinesis paths are active.
3. **Wait ≥24h** for steady-state throughput.

**Parity verification:**
Compare sent/failed counts between Kinesis consumer and SQS worker via `capi-stats`:

```bash
# Query the stats endpoint (or MySQL directly):
curl http://localhost:3000/meta/api/v1/capi-stats

# Example output:
{
  "merchants": {
    "merchant-123": {
      "sent": 15420,
      "failed": 3,
      "errors": ["rate_limit_error", "field_validation_error"]
    }
  }
}
```

**Expected behavior:**
- **Sent counts should match** (within ±1–2 for clock skew). If a large divergence appears:
  - Check Kinesis consumer logs for dropped records (rate limiter tripped, DLQ writes failed).
  - Verify `META_CAPI_AGG_MAX` and `META_CAPI_WHALE_BUCKETS` are applied consistently.
  - Confirm Meta API is not rate-limiting the Kinesis path more aggressively.

**If parity is achieved:**
- Proceed to Phase 3.

**If parity diverges:**
- Debug the consumer (see "Troubleshooting" below).
- Revert to Phase 1 and investigate.

---

### Phase 3: Kinesis-Only (SQS Drain)

**Mode:** `META_CAPI_BUS=kinesis` with `META_CAPI_CONSUMER_ENABLED=true`

**Steps:**
1. Deploy with `META_CAPI_BUS=kinesis` (SQS path disabled).
2. Allow SQS to drain naturally over **≥24h** (or manually drain with a worker script).
3. Monitor Kinesis consumer logs for errors; query `capi-stats` to confirm throughput.

**Draining SQS (if manual drain desired):**
```bash
# Option A: Let it drain at normal pace (safest).
# Continue running MetaCapiWorker for a day.

# Option B: Accelerate drain (risky; only if confident).
# Temporarily increase BATCH_SIZE and reduce WINDOW_MS, run for 1–2h.
```

**Once SQS is empty:**
- Set `META_CAPI_BATCH_SIZE=0` and disable the worker (`META_WORKER_ENABLED=false`).
- Deploy to production.

**Retire `MetaCapiWorker`:**
- Remove the worker class (file: `apps/backend/src/modules/meta/queue/capi.worker.ts`).
- Remove the worker registration from `meta.module.ts`.
- Remove SQS queue refs from infra code.

---

## DLQ — Reading Non-Retryable Events

Non-retryable errors (e.g., invalid user_data schema, field validation) are written to S3 DLQ.

**Bucket:** `META_CAPI_DLQ_BUCKET` (default: `meta-capi-dlq`)

**Key format:** `meta-capi/<date>/<merchant>/<ts>-<suffix>.json`

**Example:** `meta-capi/2026-06-22/merchant-123/1719072542000-h4qs.json`

**Payload:**
```json
{
  "events": [
    {
      "event_name": "Purchase",
      "event_id": "e1",
      "user_data": { "em": "user@example.com" },
      "custom_data": { "value": 99.99 }
    }
  ],
  "errors": [
    "non-retryable: custom_data.value must be a number (got string)"
  ]
}
```

**Reading DLQ:**
```bash
# List DLQ files for a specific merchant on a specific date:
aws s3 ls s3://meta-capi-dlq/meta-capi/2026-06-22/merchant-123/

# Download a specific file:
aws s3 cp s3://meta-capi-dlq/meta-capi/2026-06-22/merchant-123/1719072542000-h4qs.json ./event.json

# Bulk export (grep for a pattern):
aws s3 sync s3://meta-capi-dlq/meta-capi/2026-06-22/ ./dlq-export/ \
  --exclude "*" --include "*/merchant-123/*"

cat ./dlq-export/merchant-123/*.json | jq '.events | length'
```

**Action on DLQ events:**
- Review the `errors` array to identify the validation issue.
- If fixable client-side (e.g., merchant misconfigured pixel), contact the merchant.
- If a bug in hashing or PII logic, file a ticket and deploy a fix.

---

## Whale Bucket Tuning

Whale buckets route high-volume merchants to dedicated Kinesis shards to prevent backpressure on smaller merchants.

**Configuration:** `META_CAPI_WHALE_BUCKETS` (env, comma-separated)

**Format:** `merchantId:B` where `B` is the bucket (1–4, representing ≤4 dedicated shards).

**Example:**
```bash
META_CAPI_WHALE_BUCKETS="merchant-big-shop:2,merchant-hyperscale:4"
```

- `merchant-big-shop` hashes to shard bucket 2 (shards 2–3).
- `merchant-hyperscale` hashes to shard bucket 4 (shards 4–7, if stream has 8 shards).

**Tuning procedure:**
1. **Identify whale merchants:** Query `capi-stats` for merchants with >10k events/day.
2. **Estimate shard requirement:** Each Kinesis shard handles ~1k events/s (1 MB/s limit). If a merchant sends 100k/day, allocate 2 shards.
3. **Update `META_CAPI_WHALE_BUCKETS`:** Add the merchant and bucket assignment.
4. **Deploy and monitor:** Watch shard latency via CloudWatch. If consumer lag grows, increase bucket size.

**Scaling up:**
- If whale merchants exhaust allocated shards, increase Kinesis stream shard count (AWS API).
- Update `META_CAPI_WHALE_BUCKETS` to redistribute.

---

## Environment Knobs

| Env Var | Default | Values | Meaning |
|---------|---------|--------|---------|
| `META_CAPI_BUS` | `sqs` | `sqs`, `kinesis`, `both` | Ingestion routing: sqs (legacy), kinesis (new), or both (migration). |
| `META_CAPI_CONSUMER_ENABLED` | `false` | `true`, `false` | Enable Kinesis consumer (shard polling, lease management, dispatch). |
| `KINESIS_STREAM_NAME` | `meta-capi` | string | Kinesis stream name. Set to `meta-capi-local` on LocalStack. |
| `META_CAPI_DLQ_BUCKET` | `meta-capi-dlq` | string | S3 bucket for non-retryable DLQ. Set to `meta-capi-dlq-local` on LocalStack. |
| `META_CAPI_AGG_MAX` | `100` | 1–500 | Max events per Kinesis record (aggregation). Higher = fewer records, higher latency. |
| `META_CAPI_WHALE_BUCKETS` | `` | `merchantId:B,...` | Whale merchant shard routing. Empty = hash all merchants uniformly. |

**SQS worker knobs (Phase 1–2 only):**

| Env Var | Default | Meaning |
|---------|---------|---------|
| `META_CAPI_BATCH_SIZE` | `800` | Events per SQS batch before flush. |
| `META_CAPI_BATCH_WINDOW_MS` | `300000` | Milliseconds (5 min) before auto-flush. |
| `META_CAPI_VISIBILITY` | `360` | SQS visibility timeout (seconds). Must be > `WINDOW_MS`. |

**Rate limiting:**
| Env Var | Default | Meaning |
|---------|---------|---------|
| `META_CAPI_RATE_LIMIT_PER_MIN` | `60000` | Events per minute per merchant. |
| `META_RATE_LIMIT_BACKOFF_MS` | `500` | Backoff on rate limit (no checkpoint; shard stalls). |
| `META_BREAKER_THRESHOLD` | `5` | Consecutive non-retryable errors to trip circuit. |
| `META_BREAKER_RESET_MS` | `60000` | Milliseconds before circuit resets. |

---

## Local Dev: LocalStack Integration

### Setup

1. **Start LocalStack** (includes Kinesis + S3):
   ```bash
   docker run -d -p 4566:4566 -e SERVICES=kinesis,s3 localstack/localstack
   ```

2. **Create stream + bucket:**
   ```bash
   export AWS_ENDPOINT=http://localhost:4566
   
   aws kinesis create-stream \
     --stream-name meta-capi-local \
     --shard-count 1 \
     --endpoint-url $AWS_ENDPOINT \
     --region us-east-1
   
   aws s3 mb \
     s3://meta-capi-dlq-local \
     --endpoint-url $AWS_ENDPOINT \
     --region us-east-1
   ```

3. **Set env in `.env`:**
   ```bash
   KINESIS_ENDPOINT=http://localhost:4566
   S3_ENDPOINT=http://localhost:4566
   KINESIS_STREAM_NAME=meta-capi-local
   META_CAPI_DLQ_BUCKET=meta-capi-dlq-local
   META_CAPI_BUS=kinesis
   META_CAPI_CONSUMER_ENABLED=true
   ```

4. **Run backend + integration tests:**
   ```bash
   pnpm infra:up     # MySQL + backend with LocalStack env
   pnpm -r test      # vitest (integration tests gated on KINESIS_ENDPOINT + S3_ENDPOINT)
   ```

### Integration Tests

Tests in `apps/backend/src/modules/meta/capi/*.test.ts` check:
- Event hashing + PII normalization.
- Aggregation and partition key distribution.
- Rate limiting (token bucket, breaker logic).
- DLQ write on non-retryable error.
- Shard lease acquisition + checkpoint.

Tests skip gracefully if `KINESIS_ENDPOINT` or `S3_ENDPOINT` are not set; they are **not mocked locally**.

---

## Deferred Items (v1 Limitations)

### 1. KCL-Grade Cross-Replica Lease Rebalancing

**Current (v1):** Leases are stored in MySQL `meta_capi_shard_leases` with a single active consumer per shard.

**Limitation:** Only works correctly with 1 consumer pod per shard. If 2 pods contend for the same shard, one will fail `tryAcquire()` and yield; no automatic rebalancing.

**Future improvement:** Implement Kinesis Lease Coordination Library (KCL) semantics — incremental backoff, shard splitting, consumer group awareness.

**Workaround (v1):** Deploy exactly `N` consumer pods where `N ≤ shard count`. Scale by adding shards, then adding pods.

### 2. Enhanced Fan-Out (EFO)

**Current (v1):** Consumer polls stream with standard iterator; each poll returns ≤10 MB.

**Limitation:** Latency is ~1s per poll; high-volume merchants see ≤1MB/poll aggregated events.

**Future improvement:** Enable Kinesis Enhanced Fan-Out (push model) — dedicated HTTP/2 delivery per consumer, sub-100ms latency, no throttling on reads.

**Cost:** EFO charges per-consumer-shard-hour (~$0.10/h per shard per consumer). Worthwhile if SLA requires <500ms latency.

**Next steps:** Measure latency in staging; if >2s end-to-end, prioritize EFO enablement.

### 3. True Meta Rate-Limit & Partition Rebalancing

**Current (v1):** Per-merchant token bucket + circuit breaker (keyed by merchantId; per-dataset is a deferred refinement). The breaker trips automatically for ~30s when Meta returns a 429, backing off that merchant's shard drain. Meta API returns 429 (rate limit) or 400 (bad field) errors; 429s engage the breaker, but dynamic rate rebalancing is not yet implemented.

**Future improvement:** Parse Meta's `x-rate-limit-*` headers; dynamically adjust per-merchant budget. On partition key collision (same `event_id` hashing to same shard), redistribute.

**Verified in:** Staging only. Prod rollout requires load testing with real merchant patterns.

---

## Troubleshooting

### Consumer lag growing; events buffering in Kinesis

**Check 1:** Is the consumer running?
```bash
# Check pod logs for META_CAPI_CONSUMER_ENABLED:
kubectl logs -n meta -l app=svc-meta-capi | grep "consumer"
# Should see: "Meta CAPI Kinesis consumer started"
```

**Check 2:** Rate limiter tripped?
```bash
# Consumer will log: "rate_limiter tripped for merchant-X"
# and back off. Verify Redis is healthy:
redis-cli ping  # Should reply: PONG
redis-cli hgetall meta:capi:rate:merchant-123
# Shows: { "tokens": N, "updated_at": timestamp }
```

**Check 3:** DLQ writes failing?
```bash
# Check logs for "DLQ write failed":
kubectl logs -n meta -l app=svc-meta-capi | grep "DLQ write failed"
# Verify S3 bucket exists and is writable:
aws s3 ls s3://meta-capi-dlq --region ap-south-1
```

**Check 4:** Lease not acquired (contention)?
```bash
# Check MySQL lease table:
SELECT * FROM meta_capi_shard_leases WHERE stream='meta-capi' ORDER BY acquired_at DESC LIMIT 5;
# If "owner" is NULL or expired, the shard is unclaimed.
```

### Parity mismatch (Kinesis sent ≠ SQS sent)

**Check:** Are both `META_CAPI_BUS=both` and `META_CAPI_CONSUMER_ENABLED=true`?
```bash
env | grep META_CAPI
# Should show: both=true, consumer_enabled=true
```

**Check:** Aggregation max in sync?
```bash
# Both paths should use the same MAX (100 by default).
# If Kinesis sees 100 and SQS sees 1, counts will diverge.
echo $META_CAPI_AGG_MAX  # Should be same on both code paths.
```

**Check:** Time skew?
```bash
# Stats are keyed by minute (UTC). If pods' clocks are out of sync:
date; kubectl exec -n meta pod/svc-meta-capi -- date
# Sync clocks if >1s apart.
```

### DLQ bucket not found

```bash
# Verify bucket exists and is in the right region:
aws s3 ls | grep meta-capi-dlq
# If not found, create it:
aws s3 mb s3://meta-capi-dlq --region ap-south-1

# Grant backend IAM role read/write:
# (see: infra-as-code for role policy)
```

### Kinesis stream in CREATING state

```bash
# If a stream is stuck, check its status:
aws kinesis describe-stream --stream-name meta-capi
# If status is CREATING, wait a few minutes.
# If DELETING, wait for deletion before recreating.
```

---

## Rollback

### From Phase 3 → Phase 2 (emergency)

If Kinesis consumer is crashing and losing events:

1. Deploy with `META_CAPI_BUS=both` (dual-write re-enabled).
2. Set `META_CAPI_CONSUMER_ENABLED=false` (consumer stops).
3. SQS path takes over; MetaCapiWorker drains the queue.
4. Investigate consumer crash; debug and redeploy Phase 2.

### From Phase 2 → Phase 1 (rollback to SQS-only)

1. Deploy with `META_CAPI_BUS=sqs` and `META_CAPI_CONSUMER_ENABLED=false`.
2. All events route to SQS; MetaCapiWorker processes them.
3. Kinesis stream can be left running (no harm).
4. Debug Kinesis issues offline; re-enter Phase 2 when ready.

---

## Monitoring & Alerts

**Key metrics to track:**

| Metric | Threshold | Alert if |
|--------|-----------|----------|
| Consumer lag (Kinesis) | <1min | >5min |
| Rate-limited merchants | <5% | >20% |
| DLQ write errors | <1/hour | >10/hour |
| SQS queue depth (Phase 1–2) | <100 msgs | >10k msgs + lag > 5min |
| Shard lease contention | 0 failures/min | >1 failure/min |

**Dashboard query (CloudWatch):**
```
MetricStat:
  - Namespace: AWS/Kinesis
    MetricName: GetRecords.IteratorAgeMilliseconds
    Stat: Maximum
    Period: 60
    Dimensions: StreamName=meta-capi
```

---

## Related

- **Code:** `apps/backend/src/modules/meta/capi/`
- **Config:** `apps/backend/src/config/env.schema.ts` (META_CAPI_* knobs)
- **DB:** `apps/backend/src/modules/meta/db/migrations/` (shard leases, stats)
- **Tests:** `apps/backend/src/modules/meta/capi/*.test.ts` (LocalStack-gated)
