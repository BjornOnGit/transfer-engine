# Cross-Border Transfer Engine

A backend that moves money between currencies correctly: a double-entry ledger, FX rates locked per transfer, idempotent requests, and notifications that retry and are tracked instead of fired and forgotten.

**Stack:** Node.js (Express) · PostgreSQL · Redis · BullMQ · AWS (RDS, ElastiCache, EC2)

I built this to show how I approach the hard parts of payments software. The business logic (a remittance or multicurrency-wallet product) is deliberately small. The engineering around it is not.

---

## Why this project exists

Cross-border payment products fail in a handful of predictable ways:

| The failure | What it costs | How this project handles it |
| --- | --- | --- |
| Floating-point money maths | Cents appear and vanish | No floats anywhere. Amounts are strings, maths uses `decimal.js`, the database uses `NUMERIC`. |
| A balance that can drift from its history | You can't audit or trust it | An append-only double-entry ledger. Balances can be rebuilt from entries at any time. |
| Rate moves between quote and settlement | Customer is charged a different price than shown | The FX rate is locked to the transfer at creation and can't be re-locked. |
| Client retries after a timeout | Duplicate transfers | `Idempotency-Key` support. Concurrent duplicates produce exactly one transfer and identical responses. |
| Two requests spend the same money | Overdrafts | Row-level locking inside the ledger transaction. Proven with concurrency tests. |
| "Money sent, no alert received" | Support tickets, lost trust | Notifications are a tracked entity with retry, exponential backoff and a dead-letter state. |

If you have five minutes, read these in order:

1. [`src/modules/ledger/ledger.service.js`](src/modules/ledger/ledger.service.js): the double-entry write, row locking and the funds guard.
2. [`tests/ledger-concurrency.test.js`](tests/ledger-concurrency.test.js): proof that concurrent debits can't overdraw an account.
3. [`src/middleware/idempotency.middleware.js`](src/middleware/idempotency.middleware.js): duplicate-request handling.
4. [`src/modules/transfers/transfer.service.js`](src/modules/transfers/transfer.service.js): the orchestration that ties it all together.
5. [Technical decisions and trade-offs](#technical-decisions-and-trade-offs) below, for the reasoning.

---

## What it guarantees, and where that's tested

| Guarantee | Test |
| --- | --- |
| Every currency's ledger entries net to zero for each transfer | `tests/ledger.crosscurrency.test.js`, `tests/transfer-lifecycle.test.js` |
| A failure mid-transaction leaves no partial money movement | `tests/ledger.atomicity.test.js` |
| No overdraft under concurrent debits, and no deadlock on opposite-direction transfers | `tests/ledger-concurrency.test.js` |
| Cached balance can be verified against the ledger | `tests/ledger.balance.test.js` |
| Duplicate requests never create a second transfer | `tests/idempotency.test.js`, `tests/transfers.create.test.js` |
| A transfer's FX rate can be locked only once | `tests/fx.lock.test.js` |
| Invalid state transitions are impossible | `tests/transfer.state-machine.test.js` |
| Notifications retry with growing delays, then dead-letter | `tests/notification.retry.test.js`, `tests/notification.deadletter.test.js` |
| The whole journey works: signup to completed transfer to sent notification | `tests/transfer-lifecycle.test.js` |
| Bad input returns field-level 400s, never 500s | `tests/validation.test.js` |

---

## Quick start

**Prerequisites:** Node.js 20 or newer, and either Docker (for a local Postgres and Redis) or your own Postgres and Redis (for example Neon and Redis Cloud).

```bash
git clone <your-repo-url>
cd transfer-engine
npm install
cp .env.example .env
```

**Option A: local databases with Docker**

```bash
docker compose up -d        # Postgres 15 and Redis 7, with persistent volumes
```

The defaults in `.env.example` already point at these containers.

**Option B: managed databases**

Put your own connection strings in `.env`:

```
DATABASE_URL=postgres://user:password@host/dbname?sslmode=require
REDIS_URL=rediss://default:password@host:port
```

Use a development database. The test suite creates and deletes rows (see [Testing](#testing)).

**Then, for either option:**

```bash
npm run migrate             # applies the SQL migrations in /migrations
npm run seed                # two demo users with NGN and CAD accounts (safe to rerun)
npm start                   # API on http://localhost:3000
```

In a second terminal, start the notification worker. Without it, notifications stay `pending`:

```bash
npm run worker
```

Optionally, a third terminal keeps the FX rate cache warm. It's not required, because rates are fetched on demand if they're missing:

```bash
npm run fx-worker
```

Check it's alive:

```bash
curl localhost:3000/health      # {"status":"ok"}
```

### Environment variables

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP port for the API |
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string (use `rediss://` for TLS) |
| `JWT_SECRET` | Signing secret for access tokens (1 hour expiry) |

The app refuses to start, with a named error, if any of these is missing.

---

## Try it: a transfer end to end

The seed script creates two users, both with the password `password123`:

| User | NGN balance | CAD balance |
| --- | --- | --- |
| `alice@seed.test` | 500,000 | 1,000 |
| `bob@seed.test` | 250,000 | 500 |

With the server and the notification worker running, this sends 5,000 NGN from Alice's NGN account to Bob's CAD account:

```bash
H='Content-Type: application/json'
U=localhost:3000
json() { node -pe "JSON.parse(require('fs').readFileSync(0)).$1"; }

# log in as both users
login() { curl -s -X POST $U/auth/login -H "$H" -d "{\"email\":\"$1\",\"password\":\"password123\"}" | json token; }
ALICE=$(login alice@seed.test)
BOB=$(login bob@seed.test)

# find the two accounts
ALICE_NGN=$(curl -s $U/accounts -H "Authorization: Bearer $ALICE" | json "find(a => a.currency === 'NGN').id")
BOB_CAD=$(curl -s $U/accounts -H "Authorization: Bearer $BOB" | json "find(a => a.currency === 'CAD').id")

# send the money (the Idempotency-Key header is required)
curl -s -X POST $U/transfers \
  -H "Authorization: Bearer $ALICE" -H "$H" -H "Idempotency-Key: demo-1" \
  -d "{\"senderAccountId\":\"$ALICE_NGN\",\"receiverAccountId\":\"$BOB_CAD\",\"amount\":\"5000\"}"
```

The response shows `"status":"completed"`, the locked rate, and the CAD amount credited (`dest_amount`).

Now the interesting parts:

```bash
# 1. Repeat the exact same request: same response, no second transfer.
#    Look for the Idempotent-Replay: true header.
curl -si -X POST $U/transfers \
  -H "Authorization: Bearer $ALICE" -H "$H" -H "Idempotency-Key: demo-1" \
  -d "{\"senderAccountId\":\"$ALICE_NGN\",\"receiverAccountId\":\"$BOB_CAD\",\"amount\":\"5000\"}" | head -n 12

# 2. Was the recipient notified? (needs the worker running)
TRANSFER_ID=<id from the first response>
curl -s $U/transfers/$TRANSFER_ID/notifications -H "Authorization: Bearer $BOB"

# 3. Try to overspend: the transfer is recorded as failed, nothing moves.
curl -s -X POST $U/transfers \
  -H "Authorization: Bearer $ALICE" -H "$H" -H "Idempotency-Key: demo-2" \
  -d "{\"senderAccountId\":\"$ALICE_NGN\",\"receiverAccountId\":\"$BOB_CAD\",\"amount\":\"999999999\"}"
```

Both the sender and the receiver can read a transfer and its notification status. Anyone else gets a 403.

---

## API reference

All endpoints return JSON. Errors look like this, with `details` present for validation failures:

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed",
             "details": [{ "field": "amount", "message": "amount must be a positive number with at most 2 decimals" }] } }
```

| Method and path | Auth | Description |
| --- | --- | --- |
| `GET /health` | no | Liveness check |
| `POST /auth/signup` | no | Create a user |
| `POST /auth/login` | no | Returns a JWT |
| `POST /accounts` | yes | Open a currency account (`{"currency":"NGN"}`). One per currency per user. |
| `GET /accounts` | yes | List your accounts |
| `GET /accounts/:id` | yes | One account and its balance (owner only) |
| `POST /transfers` | yes, plus `Idempotency-Key` header | Create and settle a transfer |
| `GET /transfers/:id` | yes | Transfer, status and locked rate (sender or receiver only) |
| `GET /transfers/:id/notifications` | yes | Delivery status for the transfer's notifications |

`POST /transfers` body: `{ "senderAccountId": "<uuid>", "receiverAccountId": "<uuid>", "amount": "5000" }`. The amount is in the sender account's currency, positive, with at most two decimals. The two accounts must be in different currencies. Supported currencies in this demo are **NGN and CAD**.

---

## System architecture

### How the pieces talk to each other

```mermaid
flowchart LR
    Client["Client / API consumer"]

    subgraph API["Express API (one process)"]
        MW["Middleware<br/>auth · validation · idempotency"]
        TS["Transfer service<br/>orchestration + state machine"]
        FX["FX service<br/>fetch and lock rates"]
        LS["Ledger service<br/>double-entry, row locks"]
        NS["Notification service<br/>creates delivery, enqueues job"]
    end

    subgraph Workers["Background workers (separate processes)"]
        NW["Notification worker<br/>retry, backoff, dead-letter"]
        FW["FX refresh worker"]
    end

    PG[("PostgreSQL<br/>source of truth")]
    RD[("Redis<br/>rate cache · locks · BullMQ queue")]
    PROV["Mock FX provider"]
    HOOK["Webhook / push / SMS<br/>(mocked)"]

    Client --> MW --> TS
    TS --> FX
    TS --> LS
    TS --> NS
    MW -. "short idempotency lock" .-> RD
    MW -. "durable idempotency record" .-> PG
    FX -- "rate cache" --> RD
    FX -- "rate locks" --> PG
    FX -- "cache miss" --> PROV
    LS -- "one DB transaction" --> PG
    NS -- "delivery row" --> PG
    NS -- "enqueue job" --> RD
    RD -- "jobs" --> NW
    NW -- "send" --> HOOK
    NW -- "status updates" --> PG
    FW -- "refresh before expiry" --> PROV
    FW --> RD
```

**The rule that keeps this safe:** PostgreSQL is the only place money lives. Everything in Redis is either a cache of something recomputable or a short-lived coordination lock. If Redis disappeared, no financial record would be lost, and only in-flight coordination would restart.

### What happens during `POST /transfers`

```mermaid
sequenceDiagram
    participant C as Client
    participant A as API
    participant R as Redis
    participant P as PostgreSQL
    participant W as Notification worker

    C->>A: POST /transfers (Idempotency-Key)
    A->>P: Seen this key before?
    A->>R: SET idem:key NX EX 30 (one request processes at a time)
    A->>A: Validate, check ownership, check the FX pair
    A->>R: Read cached FX rate (provider on a miss)
    A->>P: Insert transfer (status: initiated)
    A->>P: Lock the rate, status: rate_locked
    rect rgba(100, 140, 200, 0.15)
        Note over A,P: One database transaction
        A->>P: Lock the 4 accounts (FOR UPDATE, in id order)
        A->>P: Check the sender has enough funds
        A->>P: Write 4 ledger entries, update balances
        A->>P: Status: funds_moved
    end
    A->>P: Status: completed
    A->>P: Store the response against the idempotency key
    A->>R: Release lock, enqueue notification
    A-->>C: 201 completed
    R-->>W: notification job
    W->>P: sent, or retrying, or dead_letter
```

### Cross-currency transfers: four ledger entries

Sending 500 NGN to a CAD account is not one debit and one credit, because the two sides are in different currencies and different amounts. The engine uses a per-currency **FX pool account** as the counterparty:

| # | Account | Direction | Amount |
| --- | --- | --- | --- |
| 1 | Sender (NGN) | debit | 500 NGN |
| 2 | NGN FX pool | credit | 500 NGN |
| 3 | CAD FX pool | debit | 0.46 CAD (500 × locked rate, rounded to 2 dp) |
| 4 | Receiver (CAD) | credit | 0.46 CAD |

Entries 1 and 2 net to zero in NGN, and entries 3 and 4 net to zero in CAD, so every currency balances independently. A pool's balance is the platform's net position in that currency.

---

## Data model

```mermaid
erDiagram
    users ||--o{ accounts : owns
    accounts ||--o{ ledger_entries : "debited or credited by"
    transfers ||--o{ ledger_entries : "produces 4"
    accounts ||--o{ transfers : "sends or receives"
    transfers ||--o| fx_rate_locks : "has at most one"
    transfers ||--o{ notification_deliveries : "notified through"
```

| Table | Notes |
| --- | --- |
| `users` | Includes one system user that owns the FX pool accounts. |
| `accounts` | One per user per currency (unique). `cached_balance` is derived from the ledger and updated in the same transaction. |
| `ledger_entries` | **Append-only.** No `updated_at`, no soft delete. Amount must be positive. Corrections are new offsetting entries. |
| `transfers` | Status is restricted by a `CHECK` constraint that mirrors the state machine. |
| `fx_rate_locks` | `UNIQUE (transfer_id)`: a transfer can only ever have one locked rate. |
| `notification_deliveries` | One row per notification: status, attempt count, last attempt time, last error. |
| `idempotency_keys` | Key, request hash and the stored response. |

**Transfer states:** `initiated → rate_locked → funds_moved → completed`. Failure is possible only before money moves (`failed`). After money moves, an undo is a `reversed` transfer, which is a new set of offsetting entries and never an edit.

---

## Infrastructure architecture (AWS)

> **Status:** this section documents the intended deployment and the exact setup steps. The Dockerfile and the deploy itself are the last, optional phase of the build plan. Locally and in development the same code runs against Neon (Postgres) and Redis Cloud.

**One clarification up front:** BullMQ is a library, not a server. There is no "BullMQ instance" to provision. Its queues live inside Redis. The pieces to deploy are the API process, the **worker process** that consumes the queue, and the Redis it shares.

```mermaid
flowchart TB
    User["Client"] -->|"HTTPS"| Edge["Elastic IP, or an Application Load Balancer<br/>with a reverse proxy for TLS"]

    subgraph VPC["AWS VPC"]
        subgraph Public["Public subnet"]
            subgraph EC2["EC2 instance — security group: app-sg"]
                API["API process<br/>node src/server.js (port 3000)"]
                NW["Notification worker<br/>node src/workers/notification-retry.worker.js"]
                FW["FX refresh worker (optional)"]
            end
        end
        subgraph Private["Private subnets — no public IPs"]
            RDS[("RDS PostgreSQL 15<br/>security group: db-sg<br/>5432 from app-sg only")]
            EC[("ElastiCache Redis<br/>security group: cache-sg<br/>6379 from app-sg only<br/>cache, locks and BullMQ queues")]
        end
    end

    Edge --> API
    API -->|"SQL over TLS"| RDS
    API -->|"cache, locks, enqueue jobs"| EC
    NW -->|"consume jobs"| EC
    NW -->|"delivery status"| RDS
    FW --> EC
    SM["Secrets Manager<br/>DATABASE_URL, REDIS_URL, JWT_SECRET"] -.->|"read at startup via IAM role"| EC2
    EC2 -.->|"logs and metrics"| CW["CloudWatch"]
```

### Setting it up

1. **Network.** Use one VPC with a public subnet for the EC2 instance and at least two private subnets in different availability zones (RDS and ElastiCache both require subnet groups spanning two AZs).
2. **Security groups.** This is what lets the instance talk to the databases and keeps everyone else out:

   | Group | Inbound rule |
   | --- | --- |
   | `app-sg` (EC2) | 443 (or 80/3000 for a demo) from the internet. 22 (SSH) from your own IP only. |
   | `db-sg` (RDS) | **5432 from `app-sg` only** (reference the security group, not an IP range) |
   | `cache-sg` (ElastiCache) | **6379 from `app-sg` only** |

3. **RDS.** PostgreSQL 15, **Public access: No**, placed in the private subnets with `db-sg`. Create a `transfer_engine` database.
4. **ElastiCache.** Redis in the private subnets with `cache-sg`. Two settings matter:
   - Set `maxmemory-policy` to **`noeviction`** in the parameter group. BullMQ needs this so queued jobs are never evicted under memory pressure.
   - Enable in-transit encryption, which means the URL is `rediss://` (and `rediss://:<auth-token>@host:6379` if you enable an auth token).
5. **Secrets.** Store `DATABASE_URL`, `REDIS_URL` and `JWT_SECRET` in Secrets Manager. Give the EC2 instance an IAM role that can read them, and inject them as environment variables when the processes start. Nothing secret goes in the image or the repo.
6. **EC2.** A small instance (for example `t3.small`) in the public subnet with `app-sg`. Run the API and the worker as **two separate processes** (two containers once the Dockerfile exists, or two systemd services). Run `npm run migrate` once per deploy before starting the API.
7. **Connection strings.** Both databases are reachable only from inside the VPC, so these only work from the EC2 instance:
   ```
   DATABASE_URL=postgres://<user>:<password>@<rds-endpoint>:5432/transfer_engine?sslmode=require
   REDIS_URL=rediss://<elasticache-primary-endpoint>:6379
   ```
   If Node reports `self-signed certificate in certificate chain` for RDS, download Amazon's RDS CA bundle and start the process with `NODE_EXTRA_CA_CERTS=/path/to/global-bundle.pem`. No code change is needed.
8. **Verify.** `curl https://<your-host>/health` returns `200`. Then run the transfer walkthrough above against the public URL.
9. **Observability.** Ship logs to CloudWatch. The headline dashboard to build is **notification delivery success rate**, taken from `notification_deliveries.status`, because that is the problem this project exists to make visible.

For a demo, one EC2 instance running both processes is enough. The path to production is separate worker instances (or ECS Fargate services), Multi-AZ RDS, and a Redis replica.

---

## Technical decisions and trade-offs

Every choice below has a cost. The costs are listed because they're the interesting part.

### PostgreSQL, not MySQL
- **Why:** money maths benefits from the exact `NUMERIC` type, strong `CHECK` constraints, and well-defined row-locking behavior. A ledger depends on the database refusing bad data.
- **Trade-off:** MySQL has the larger hosting-skills pool. Neither is wrong, but Postgres fits a ledger better.

### Money is a string in code and `NUMERIC` in the database
- **Why:** floats can't represent 0.1 + 0.2 exactly. Amounts travel as strings, arithmetic goes through one small module (`src/lib/money.js` over `decimal.js`), and a unit test fails against a float implementation.
- **Trade-off:** more ceremony than `a + b`, and every developer has to follow the rule. Funnelling all maths through one module is what makes the rule enforceable.

### An append-only double-entry ledger, with a cached balance
- **Why:** every movement is a pair of entries that net to zero, and entries are never edited. That makes the system auditable by construction: any balance can be rebuilt by replaying entries (`getBalanceFromLedger`).
- **Trade-off:** `accounts.cached_balance` is a second copy of the truth, kept in sync inside the same transaction. It's fast to read, but it needs reconciliation discipline. A scheduled job that compares the two is on the roadmap below.

### Cross-currency via FX pool accounts (four entries), not one pair
- **Why:** a single debit and credit can't express 500 NGN in and 0.46 CAD out. With a pool account per currency, each currency balances to zero on its own, which is how real multi-currency ledgers behave.
- **Trade-off:** more complex than a single pair. Pool balances go negative in one currency and positive in another, which represents the platform's open position. There's no liquidity management on top of that yet.

### The FX rate is locked at initiation
- **Why:** the price the customer was shown is the price charged, and a unique constraint makes re-locking impossible. Rates come from a cache in Redis (30 second TTL) that a background worker keeps warm.
- **Trade-off:** the provider is mocked (a base rate with ±0.5% drift). Locks carry an `expires_at`, but since transfers settle immediately in this version it isn't enforced yet. It would matter for a separate quote-then-confirm flow.

### Pessimistic row locking, not optimistic retries
- **Why:** the ledger transaction locks all involved accounts with `SELECT ... FOR UPDATE` before checking the balance. Concurrent debits then queue and the second sees the true balance. Accounts are always locked in `id` order, so opposite-direction transfers can't deadlock.
- **Trade-off:** a very hot account becomes a serialization point. At this scale that's the correct trade for guaranteed correctness. Both the overdraft race and the deadlock case have tests, and removing the lock makes them fail.

### Idempotency is two layers: a Redis lock plus a Postgres record
- **Why:** the Redis lock (`SET NX EX 30`) stops two identical requests processing at once. The Postgres row is the durable record that survives restarts and serves replays. A concurrent duplicate waits for the first to finish and receives the identical response. Reusing a key with a different payload is rejected (422). Keys are namespaced by user.
- **Trade-off:** 4xx results are stored and replayed, but 5xx results are not, so a transient server failure can be retried safely. Stored keys have no expiry job yet.

### The state machine is enforced twice
- **Why:** the application checks transitions with a pure, unit-tested module, and the database restricts the status column to the same set of values. Transitions are compare-and-set updates (`WHERE status = <expected>`), and the `funds_moved` update happens inside the ledger transaction, so money and status can never disagree.
- **Trade-off:** the rules live in two places and must be kept aligned.

### Notifications are a tracked entity, not fire-and-forget
- **Why:** a `notification_deliveries` row exists before the job is queued, so "was the customer told?" is a query instead of a support ticket. BullMQ provides exponential backoff (1, 2, 4, 8 seconds, 5 attempts). After the last attempt the row becomes `dead_letter` and the job stays in BullMQ's failed set for manual follow-up.
- **Trade-off:** delivery is at-least-once, so receivers should de-duplicate. A notification failure never fails the transfer, because the money has already moved. The table stores the latest attempt, not a log of every attempt.

### Redis only holds what can be recomputed
- **Why:** cache, short locks and queue state. If Redis vanished, no financial record would be lost.
- **Trade-off:** the notification queue lives in Redis, so jobs not yet processed would be lost. Their `pending` delivery rows would remain in Postgres, which makes the loss detectable, though nothing re-enqueues them automatically yet.

### A modular monolith with raw SQL
- **Why:** modules (`accounts`, `fx`, `transfers`, `ledger`, `notifications`, `auth`) have clear boundaries and each follows routes, controller, service, repository. It is simple to run and reason about, and any module could be extracted later. Plain SQL via `pg` keeps transactions, locks and constraints explicit and visible in review, which matters in a ledger.
- **Trade-off:** more boilerplate than an ORM, and no automatic schema typing.

### Real infrastructure in tests, with failure injection
- **Why:** tests run against real Postgres and Redis. The atomicity test makes the ledger throw halfway and checks that nothing persisted. The concurrency tests fire real simultaneous transactions. Money-critical tests are the kind that mocks can't honestly cover.
- **Trade-off:** the suite needs a database, takes minutes against remote services, and must only ever run against a development database.

---

## Testing

```bash
npm test
```

This runs the whole suite with Node's built-in test runner (no extra framework).

> **Important:** the tests use the databases in your `.env` and create and delete rows (users named like `*@test.com`, their accounts, transfers and ledger entries). Run them against a **development** database, never one that holds real data. They clean up after themselves, and they restore the FX pool balances they touch.

Against remote Postgres and Redis (for example Neon and Redis Cloud) the full suite takes several minutes because every round trip crosses the network. Against local Docker containers it's much faster. The timing-based tests use generous bounds for that reason.

---

## Project structure

```
transfer-engine/
├── src/
│   ├── config/            env validation, Postgres pool, Redis client
│   ├── middleware/        auth, request validation (zod), idempotency, error handler
│   ├── lib/               money.js (decimal arithmetic), queue.js (BullMQ)
│   ├── modules/
│   │   ├── auth/          signup, login, password hashing
│   │   ├── accounts/      per-user, per-currency accounts
│   │   ├── fx/            rate provider, Redis cache, rate locking, FX pool lookup
│   │   ├── ledger/        double-entry core (the heart of the system)
│   │   ├── transfers/     orchestration and the state machine
│   │   └── notifications/ deliveries, dispatcher with retry and dead-letter
│   ├── workers/           notification worker, FX rate refresh worker
│   ├── app.js             builds the Express app
│   └── server.js          starts it
├── migrations/            numbered SQL files, a small runner, and the seed script
├── tests/                 unit, integration, failure-injection and concurrency tests
├── docker-compose.yml     local Postgres and Redis
└── .env.example
```

---

## Limitations, and what I'd add with more time

### Known simplifications in this version
- **Funding.** There's no deposit or withdrawal flow. Seeded demo balances are written directly to `cached_balance`, so they have no ledger entries behind them and won't reconcile against the ledger. The tests fund accounts through the ledger from a throwaway treasury account. A real deposit flow would do the same with a permanent treasury account.
- **Two currencies, mocked providers.** Only NGN and CAD are supported. The FX provider and the webhook sender are mocks behind small interfaces, so real ones can slot in.
- **Cross-currency only.** Same-currency transfers are rejected. They'd skip the FX step and use the simpler two-entry path the ledger already supports.
- **Two-decimal amounts.** There's no per-currency minor-unit table (for example, currencies with zero or three decimals).
- **Reversals.** The `reversed` state and the offsetting-entry design exist, but there's no endpoint that triggers one yet.

### Next steps I'd prioritise
1. **Reconciliation job:** a scheduled check that every account's `cached_balance` equals its ledger-derived balance, alerting on any drift. This is the safety net for the cached-balance design.
2. **Transactional outbox for notifications:** write the "send this" intent inside the same transaction that completes the transfer, then publish from it. That closes the small window where Redis is down and a delivery row exists without a queued job.
3. **Recovery job for stuck transfers:** sweep transfers left in `rate_locked` or `funds_moved` by a crash and resolve them safely.
4. **Quote-then-confirm flow:** `POST /quotes` returns a rate valid for N seconds, and a transfer consumes the quote. This is where the stored `expires_at` becomes enforced.
5. **A real FX provider** with a spread or fee model, and provider failover.
6. **A per-attempt notification log** (a `notification_attempts` table), signed webhooks (HMAC), and real push and SMS providers.
7. **Deposits, withdrawals and reversals** as first-class ledger operations.

### Production hardening
- **Security and compliance:** refresh tokens, rate limiting, account lockout, KYC and sanctions-screening hooks, and per-user transfer limits.
- **Observability:** structured logs with request IDs, metrics and tracing, and the CloudWatch dashboard for notification success rate.
- **Operations:** a Dockerfile, CI that runs the suite against service containers, infrastructure as code (Terraform or CDK), graceful worker shutdown, BullMQ repeatable jobs in place of `setInterval` for the FX refresh, and an expiry job for idempotency keys.
- **Scale:** read replicas, partitioning `ledger_entries` by date, and Multi-AZ failover.
- **Developer experience:** an OpenAPI spec, pagination on list endpoints, and ephemeral test databases (for example Testcontainers) so tests never touch a shared database.

---

## Author

**Your name** · [LinkedIn](https://linkedin.com/in/your-handle) · [GitHub](https://github.com/your-handle) · your@email.com