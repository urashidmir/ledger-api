# Simple Ledger API

A small in-memory ledger API: create accounts, record deposits/withdrawals
against them, check balances, and view transaction history. No UI — API only.

## Assumptions

- **Multiple accounts, no owners.** Each account has its own balance and
  history, identified by a server-generated id. There's no user model —
  anyone holding an account id can operate on it.
- **No auth, no persistence, no logging** beyond a line on startup.
- **Deposits and withdrawals only** — no transfers between accounts.
- **Monetary values are JSON numbers**, the same type in requests and
  responses. `amount` must be finite and strictly greater than 0. No currency
  or unit is assumed — the amount is whatever unit the caller has in mind, so
  pick one and be consistent. Balances are held internally as
  arbitrary-precision decimals so error never *accumulates* across
  transactions, but each value is bounded by double precision (~15–17
  significant digits) as it crosses the wire.

## Design decisions

- **Overdrafts return `422`, not `400`.** An over-balance withdrawal is a
  well-formed request that's invalid given current state, not malformed input.
  `400` stays reserved for bad request shape.
- **Transactions are immutable.** Nothing is edited or deleted; a mistake is
  corrected by posting an opposite transaction. This keeps the history an
  audit trail rather than a mutable log.
- **Arbitrary-precision decimals, not floats.** Balances use `decimal.js`, so
  repeated deposits and withdrawals never accumulate IEEE-754 noise (`0.1 +
  0.2` yielding `0.30000000000000004`) — there's no error to round away in the
  first place. An earlier version rounded to the nearest 1e-9 instead, which
  broke silently above ≈9,007,199 because `Math.round(x * 1e9)` overflows
  `Number.MAX_SAFE_INTEGER`; it was replaced rather than patched.
- **No concurrency control.** `Account.recordTransaction()` performs the
  overdraft check, balance update, and history append synchronously with no
  `await` between them, so two requests cannot interleave within it. Adding an
  `await` to that path would reopen the window — see "Single-process only".
- **Idempotency keys make retries safe.** At-least-once retry behaviour
  (network blips, client timeouts) is handled by the server rather than pushed
  onto every caller. Repeating a key with identical parameters returns the
  original transaction; repeating it with different ones is a `409`.
- **Cursor pagination, not offset.** `startingAfter=<transactionId>` keeps
  results stable as new transactions are appended mid-paging; an offset would
  skip or repeat rows once the list shifts.
- **Cap-and-evict.** `description` is capped at 500 characters, request bodies
  at 10kb, and history at the most recent 10,000 transactions per account
  (oldest evicted first). This bounds memory without external storage. The
  balance is tracked independently of the history array and so is unaffected
  by eviction; idempotency keys are not (see below).
- **JSON everywhere.** Unknown routes and malformed bodies return JSON errors
  rather than Express's HTML error page, so clients never branch on content
  type.

## Known limitations / what I'd do next

- **No persistence.** Next step: the same read/write API over Postgres, with
  the transaction table append-only to preserve immutability.
- **No auth.** Next step: per-account credentials or bearer tokens, checked
  per request.
- **No transfers.** A transfer must debit one account and credit another
  atomically, which needs a real cross-account transaction boundary rather
  than two independent calls.
- **Idempotency keys are evicted with their transaction**, so a very old key
  can silently become reusable. Production would need a separate,
  longer-lived idempotency store decoupled from history retention.
- **Single-process only.** The no-locking decision holds only while that
  read-modify-write stays synchronous. A real datastore would need an
  in-process per-account lock (a promise chain keyed by account id); multiple
  instances would need cross-process locking, since separate processes cannot
  coordinate through memory.
- **Corrections are indistinguishable from genuine movements.** There's no
  `reversalOf` link on a transaction, so a compensating entry reads as an
  ordinary deposit or withdrawal.

## Requirements

- Node.js 18+

## Running it

```bash
npm install
npm run dev      # http://localhost:3000, override with PORT
```

```bash
npm run build && npm start    # compiled build
npm test                      # test suite
```

## API

### Errors

Every error response uses the same envelope:

```json
{ "error": "Withdrawal amount exceeds the available balance." }
```

### `POST /accounts`

Create an account with a zero balance. No request body.

`201 Created`:

```json
{ "id": "b6e1c2b0-...", "balance": 0, "createdAt": "2026-08-14T12:00:00.000Z" }
```

### `GET /accounts`

Lists every account. Unpaginated.

```json
{ "accounts": [{ "id": "b6e1c2b0-...", "balance": 100, "createdAt": "..." }] }
```

### `GET /accounts/:accountId`

A single account's id, balance, and creation time.

- `404` — no account with that id.

### `POST /accounts/:accountId/transactions`

```json
{ "type": "deposit", "amount": 100, "description": "Initial deposit" }
```

- `type` — `"deposit"` or `"withdrawal"` (required)
- `amount` — number, `> 0` (required)
- `description` — string (optional, max 500 chars)

Send an `Idempotency-Key` header to make retries safe: an identical repeat
returns the original transaction instead of recording a second one, a
differing one returns `409`. Keys expire with their transaction (see
cap-and-evict).

- `201 Created` — the created transaction, including the resulting balance.
- `400` — malformed request body or header.
- `404` — no account with that id.
- `409` — key already used with different parameters.
- `422` — withdrawal exceeds current balance.

### `GET /accounts/:accountId/balance`

```json
{ "balance": 100 }
```

- `404` — no account with that id.

### `GET /accounts/:accountId/transactions`

A page of history, oldest first.

- `limit` — defaults to 50; values above 200 are clamped to 200; non-positive
  or non-integer values are rejected.
- `startingAfter` — a transaction `id`; resume from the transaction after it.
  Pass the last id from the previous page.

```json
{
  "transactions": [
    {
      "id": "e2b1c2b0-...",
      "type": "deposit",
      "amount": 100,
      "balanceAfter": 100,
      "description": "Initial deposit",
      "createdAt": "2026-08-14T12:00:00.000Z"
    }
  ],
  "hasMore": false
}
```

`hasMore` is `true` when another page is available.

- `400` — invalid `limit`, or `startingAfter` no longer in history (it may
  have been evicted).
- `404` — no account with that id.

## Examples

```bash
# Create an account
curl -X POST http://localhost:3000/accounts

# Deposit
curl -X POST http://localhost:3000/accounts/<accountId>/transactions \
  -H "Content-Type: application/json" \
  -d '{"type": "deposit", "amount": 100, "description": "Initial deposit"}'

# Safely retry — same key returns the original transaction, not a second one
curl -X POST http://localhost:3000/accounts/<accountId>/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 3f8e7b2a-checkout-42" \
  -d '{"type": "deposit", "amount": 100, "description": "Initial deposit"}'

# Overdraft — fails with 422, no state change
curl -X POST http://localhost:3000/accounts/<accountId>/transactions \
  -H "Content-Type: application/json" \
  -d '{"type": "withdrawal", "amount": 1000000}'

# Balance and history
curl http://localhost:3000/accounts/<accountId>/balance
curl "http://localhost:3000/accounts/<accountId>/transactions?limit=20&startingAfter=<lastTransactionId>"
```
