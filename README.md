# Simple Ledger API

A small in-memory ledger API: create accounts, record deposits/withdrawals
against them, check balances, and view transaction history. No UI — API only.

## Assumptions

- **Multiple accounts, no owners.** The ledger tracks any number of
  independent accounts, each with its own balance and transaction history,
  identified by a server-generated id. There's no concept of a user who owns
  an account — anyone who has an account's id can operate on it.
- **No inter-account transactions.** Deposits and withdrawals only affect the
  single account they're posted against — there's no transfer operation that
  debits one account and credits another atomically.
- **In-memory storage only.** All data lives in a process-local variable and
  is lost when the server restarts. No database, no file persistence.
- **No authentication/authorisation.** Every endpoint is open.
- **No logging/monitoring** beyond the default `console.log` on startup.
- **Monetary values are JSON numbers, not strings.** `amount` in a
  transaction request, and every `balance`/`balanceAfter` in a response, are
  plain IEEE-754 double-precision JSON numbers — the same type across the
  whole API. `amount` must be finite and strictly greater than 0. There's no
  currency/locale/decimal-precision handling — the amount is whatever unit
  the caller has in mind (e.g. dollars, cents — pick one and be consistent).
  Internally, running balances are tracked with arbitrary-precision decimals
  to avoid *accumulating* floating-point error across transactions (see
  "Balance arithmetic..." below) — but every value that crosses the wire is
  still a JSON number, so a single value is still bounded by double
  precision (~15-17 significant digits) at that boundary, same as any JSON
  API.

## Design decisions

- **Overdrafts return `422`, not `400`.** A withdrawal whose amount exceeds
  the current balance is a well-formed request that's invalid given the
  account's current state, not a malformed one — so it fails with
  `422 Unprocessable Entity` and no state change, while `400` stays reserved
  for bad input shape (missing/invalid fields).
- **Transactions are immutable.** Once recorded, a transaction can't be
  edited, reversed, or deleted — correcting a mistake means posting a new,
  opposite transaction. This keeps the history an honest audit trail instead
  of a mutable log.
- **Balance arithmetic uses arbitrary-precision decimals, not floats.** An
  account's running balance is tracked with `decimal.js` rather than a plain
  JS `number`, so deposits/withdrawals never accumulate IEEE-754 binary
  representation noise (e.g. `0.1 + 0.2` producing `0.30000000000000004`
  instead of `0.3`) — there's no error to round away in the first place.
- **No concurrency control.** Not needed here: the balance read-modify-write
  in `Account.recordTransaction()` — the overdraft check, the balance
  update, and the history append — is entirely synchronous, with no `await`
  anywhere in between. Node's event loop can still interleave *different*
  requests' async work in general, but a synchronous function body always
  runs to completion before the next callback gets a turn, so two requests
  can never interleave partway through the same account's read-modify-write.
  Putting any `await` into that path (e.g. a real database call) would
  reopen this window — see "Single-process only" below.
- **Idempotency keys make retries safe.** Sending the same `Idempotency-Key`
  header again with the *same* `type`/`amount`/`description` returns the
  original transaction instead of recording a second one; reusing a key with
  *different* parameters is rejected with `409 Conflict`. This makes
  at-least-once retry behaviour (network blips, client timeouts) safe by
  default rather than pushing dedup logic onto every caller.
- **Cursor-based pagination, not offset.** `GET /transactions` pages are
  navigated with `startingAfter=<transactionId>` rather than a page number
  or offset, so results stay stable even as new transactions are appended
  concurrently with paging — an offset would skip or repeat rows once the
  underlying list shifts.
- **Bounded in-memory store (cap-and-evict).** `description` is capped at
  500 characters, the JSON request body at 10kb, and only the most recent
  10,000 transactions per account are retained (older ones evicted
  first-in-first-out). This bounds memory growth without external storage.
  The running `balance` is unaffected by eviction — it's tracked
  independently of the history array — but idempotency keys tied to evicted
  transactions do become reusable (see "Known limitations" below).
- **JSON everywhere.** Unknown routes and malformed request bodies get a
  JSON error response (`404`/`400`) rather than Express's default HTML error
  page, so clients never need to branch on content type.

## Known limitations / what I'd do next

- **No persistence.** An in-memory store means a restart loses all data.
  Next step: back the same read/write API with a real datastore (e.g.
  Postgres), likely with the transaction table modeled as append-only to
  preserve the immutability guarantee above.
- **No auth.** Anyone with an account id can operate on it. Next step:
  per-account credentials or bearer tokens, checked per request.
- **No inter-account transfers.** Deposits/withdrawals only. A transfer
  endpoint would need to debit one account and credit another atomically,
  which the current single-account transaction model doesn't support —
  it'd need a real cross-account transaction boundary (a DB transaction, or
  equivalent) rather than two independent calls.
- **Idempotency keys are evicted with their transaction.** Because history
  is capped at 10,000 transactions per account, a very old idempotency key
  can silently become reusable once its transaction is evicted. A
  production system would need a separate, longer-lived idempotency store
  decoupled from transaction history retention.
- **Single-process only.** The "no concurrency control" decision above holds
  only because the balance read-modify-write is synchronous end-to-end.
  Swapping in a real datastore (see "No persistence" above) or running
  multiple instances for scale/availability would put an `await` in that
  path and reopen the interleaving window this design currently avoids —
  either would need real locking or transactions to stay safe.

## Requirements

- Node.js 18+

## Running it

```bash
npm install
npm run dev
```

This starts the server on `http://localhost:3000` (override with the `PORT`
env var, e.g. `PORT=4000 npm run dev`).

To run a compiled build instead:

```bash
npm run build
npm start
```

To run the test suite:

```bash
npm test
```

## API

### `POST /accounts`

Create a new account with a zero balance. No request body needed.

Response `201 Created`:

```json
{ "id": "b6e1c2b0-...", "balance": 0, "createdAt": "2026-08-14T12:00:00.000Z" }
```

### `GET /accounts`

Lists every account.

```json
{ "accounts": [{ "id": "b6e1c2b0-...", "balance": 100, "createdAt": "..." }] }
```

### `GET /accounts/:accountId`

Returns a single account's summary (id, balance, creation time).

- `404 Not Found` — no account with that id.

### `POST /accounts/:accountId/transactions`

Record a deposit or withdrawal against the given account.

Request body:

```json
{ "type": "deposit", "amount": 100, "description": "Initial deposit" }
```

- `type`: `"deposit"` or `"withdrawal"` (required)
- `amount`: number, must be `> 0` (required)
- `description`: string (optional)

Optionally send an `Idempotency-Key` header to make retries safe: if the same
key is sent again with the *same* `type`/`amount`/`description`, the original
transaction is returned rather than being recorded twice. Reusing a key with
*different* parameters is rejected with `409 Conflict`. A key stays valid for
as long as its transaction remains in history (see "Bounded in-memory store
(cap-and-evict)" above) — once evicted, the key can be reused.

Responses:

- `201 Created` — the created transaction, including the resulting balance.
- `400 Bad Request` — invalid `type`, invalid `amount`, invalid `description`,
  or invalid `Idempotency-Key`.
- `404 Not Found` — no account with that id.
- `409 Conflict` — the `Idempotency-Key` was already used with different
  transaction parameters.
- `422 Unprocessable Entity` — withdrawal amount exceeds current balance.

### `GET /accounts/:accountId/balance`

Returns the account's current balance.

```json
{ "balance": 100 }
```

- `404 Not Found` — no account with that id.

### `GET /accounts/:accountId/transactions`

Returns a page of the account's transaction history, in chronological order.

Query parameters:

- `limit`: number of transactions to return. Defaults to 50; values above 200
  are clamped to 200; non-positive or non-integer values are rejected.
- `startingAfter`: a transaction `id` — resume the list from the transaction
  immediately after it. Pass the `id` of the last transaction on the previous
  page to fetch the next one.

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

`hasMore` is `true` when another page is available; fetch it by passing the
last returned transaction's `id` as `startingAfter`.

Responses:

- `200 OK` — the page of transactions.
- `400 Bad Request` — invalid `limit`, or `startingAfter` doesn't match a
  transaction still in this account's history (older transactions can be
  evicted — see "Bounded in-memory store (cap-and-evict)" above).
- `404 Not Found` — no account with that id.

## Examples

Create an account:

```bash
curl -X POST http://localhost:3000/accounts
```

Make a deposit (substitute the account id returned above):

```bash
curl -X POST http://localhost:3000/accounts/<accountId>/transactions \
  -H "Content-Type: application/json" \
  -d '{"type": "deposit", "amount": 100, "description": "Initial deposit"}'
```

Safely retry a deposit (send the same `Idempotency-Key` again to get the
original transaction back instead of recording a second one):

```bash
curl -X POST http://localhost:3000/accounts/<accountId>/transactions \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 3f8e7b2a-checkout-42" \
  -d '{"type": "deposit", "amount": 100, "description": "Initial deposit"}'
```

Make a withdrawal:

```bash
curl -X POST http://localhost:3000/accounts/<accountId>/transactions \
  -H "Content-Type: application/json" \
  -d '{"type": "withdrawal", "amount": 40, "description": "Groceries"}'
```

Attempt an overdraft (fails with 422):

```bash
curl -X POST http://localhost:3000/accounts/<accountId>/transactions \
  -H "Content-Type: application/json" \
  -d '{"type": "withdrawal", "amount": 1000000}'
```

Check the balance:

```bash
curl http://localhost:3000/accounts/<accountId>/balance
```

View transaction history:

```bash
curl http://localhost:3000/accounts/<accountId>/transactions
```

Page through history (substitute the last transaction id from the previous
page):

```bash
curl "http://localhost:3000/accounts/<accountId>/transactions?limit=20&startingAfter=<lastTransactionId>"
```
