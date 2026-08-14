# Simple Ledger API

A small in-memory ledger API: record deposits/withdrawals, check the current
balance, and view transaction history. No UI — API only.

## Assumptions

- **Single global account.** There is no concept of users/accounts — the
  whole app tracks one balance and one transaction history.
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

### `POST /transactions`

Record a deposit or withdrawal.

Request body:

```json
{ "type": "deposit", "amount": 100, "description": "Initial deposit" }
```

- `type`: `"deposit"` or `"withdrawal"` (required)
- `amount`: number, must be `> 0` (required)
- `description`: string (optional)

Responses:

- `201 Created` — the created transaction, including the resulting balance.
- `400 Bad Request` — invalid `type`, invalid `amount`, or invalid `description`.
- `422 Unprocessable Entity` — withdrawal amount exceeds current balance.

### `GET /balance`

Returns the current balance.

```json
{ "balance": 100 }
```

### `GET /transactions`

Returns the full transaction history, in chronological order.

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

## Examples

Make a deposit:

```bash
curl -X POST http://localhost:3000/transactions \
  -H "Content-Type: application/json" \
  -d '{"type": "deposit", "amount": 100, "description": "Initial deposit"}'
```

Make a withdrawal:

```bash
curl -X POST http://localhost:3000/transactions \
  -H "Content-Type: application/json" \
  -d '{"type": "withdrawal", "amount": 40, "description": "Groceries"}'
```

Attempt an overdraft (fails with 422):

```bash
curl -X POST http://localhost:3000/transactions \
  -H "Content-Type: application/json" \
  -d '{"type": "withdrawal", "amount": 1000000}'
```

Check the balance:

```bash
curl http://localhost:3000/balance
```

View transaction history:

```bash
curl http://localhost:3000/transactions
```
