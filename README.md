# Simple Ledger API

A small in-memory ledger API: create accounts, record deposits/withdrawals
against them, check balances, and view transaction history. No UI — API only.

## Assumptions

- **Multiple accounts, no owners.** The ledger tracks any number of
  independent accounts, each with its own balance and transaction history,
  identified by a server-generated id. There's no concept of a user who owns
  an account — anyone who has an account's id can operate on it.
- **In-memory storage only.** All data lives in a process-local variable and
  is lost when the server restarts. No database, no file persistence.
- **No authentication/authorisation.** Every endpoint is open.
- **Overdrafts are rejected.** A withdrawal whose amount exceeds the current
  balance fails with `422 Unprocessable Entity` and no state change.
- **Amounts are plain numbers**, must be finite and strictly greater than 0.
  There's no currency/locale/decimal-precision handling — the amount is
  whatever unit the caller has in mind (e.g. dollars, cents — pick one and be
  consistent).
- **No concurrency control.** Not needed for this exercise: Node's
  single-threaded event loop processes each request to completion before
  starting the next, so there's no risk of interleaved reads/writes on the
  in-memory store.
- **No logging/monitoring** beyond the default `console.log` on startup.
- **Bounded in-memory store.** `description` is capped at 500 characters, the
  JSON request body is capped at 10kb, and only the most recent 10,000
  transactions are retained (older ones are evicted first-in-first-out). The
  running `balance` is unaffected by eviction — it's tracked independently of
  the history array.
- **JSON everywhere.** Unknown routes and malformed request bodies get a JSON
  error response (`404`/`400`) rather than Express's default HTML error page,
  so clients never need to branch on content type.

## Requirements

- Node.js 18+ (for the built-in `crypto.randomUUID`)

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
as long as its transaction remains in history (see "Bounded in-memory store"
below) — once evicted, the key can be reused.

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

Returns the account's full transaction history, in chronological order.

```json
{
  "transactions": [
    {
      "id": "e2b1c2b0-...",
      "type": "deposit",
      "amount": 100,
      "balanceAfter": 100,
      "description": "Initial deposit",
      "timestamp": "2026-08-14T12:00:00.000Z"
    }
  ]
}
```

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
