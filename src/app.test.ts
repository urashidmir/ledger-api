import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "./app";

async function createAccount(app: ReturnType<typeof createApp>) {
  const res = await request(app).post("/accounts").send();
  return res.body.id as string;
}

test("POST /accounts creates an account with a zero balance", async () => {
  const app = createApp();
  const res = await request(app).post("/accounts").send();

  assert.equal(res.status, 201);
  assert.equal(res.body.balance, 0);
  assert.equal(typeof res.body.id, "string");
});

test("GET /accounts lists every created account", async () => {
  const app = createApp();
  const idA = await createAccount(app);
  const idB = await createAccount(app);

  const res = await request(app).get("/accounts");
  const ids = res.body.accounts.map((account: { id: string }) => account.id);

  assert.equal(res.status, 200);
  assert.deepEqual(new Set(ids), new Set([idA, idB]));
});

test("GET /accounts/:accountId returns 404 for an unknown account", async () => {
  const app = createApp();
  const res = await request(app).get("/accounts/does-not-exist");

  assert.equal(res.status, 404);
  assert.match(res.headers["content-type"], /json/);
});

test("POST /accounts/:accountId/transactions creates a deposit", async () => {
  const app = createApp();
  const accountId = await createAccount(app);

  const res = await request(app)
    .post(`/accounts/${accountId}/transactions`)
    .send({ type: "deposit", amount: 100, description: "pay" });

  assert.equal(res.status, 201);
  assert.equal(res.body.type, "deposit");
  assert.equal(res.body.balanceAfter, 100);
});

test("POST /accounts/:accountId/transactions rejects an invalid type with 400", async () => {
  const app = createApp();
  const accountId = await createAccount(app);

  const res = await request(app)
    .post(`/accounts/${accountId}/transactions`)
    .send({ type: "bogus", amount: 10 });

  assert.equal(res.status, 400);
});

test("POST /accounts/:accountId/transactions rejects an invalid amount with 400", async () => {
  const app = createApp();
  const accountId = await createAccount(app);

  const res = await request(app)
    .post(`/accounts/${accountId}/transactions`)
    .send({ type: "deposit", amount: -5 });

  assert.equal(res.status, 400);
});

test("POST /accounts/:accountId/transactions rejects an overlong description with 400", async () => {
  const app = createApp();
  const accountId = await createAccount(app);

  const res = await request(app)
    .post(`/accounts/${accountId}/transactions`)
    .send({ type: "deposit", amount: 10, description: "x".repeat(1000) });

  assert.equal(res.status, 400);
});

test("POST /accounts/:accountId/transactions rejects an overdraft with 422 and leaves the balance unchanged", async () => {
  const app = createApp();
  const accountId = await createAccount(app);

  const res = await request(app)
    .post(`/accounts/${accountId}/transactions`)
    .send({ type: "withdrawal", amount: 10 });

  assert.equal(res.status, 422);

  const balance = await request(app).get(`/accounts/${accountId}/balance`);
  assert.equal(balance.body.balance, 0);
});

test("POST /accounts/:accountId/transactions returns 404 for an unknown account", async () => {
  const app = createApp();

  const res = await request(app)
    .post("/accounts/does-not-exist/transactions")
    .send({ type: "deposit", amount: 10 });

  assert.equal(res.status, 404);
});

test("retrying POST /accounts/:accountId/transactions with the same Idempotency-Key returns the original transaction", async () => {
  const app = createApp();
  const accountId = await createAccount(app);
  const body = { type: "deposit", amount: 100, description: "pay" };

  const first = await request(app)
    .post(`/accounts/${accountId}/transactions`)
    .set("Idempotency-Key", "retry-1")
    .send(body);
  const retry = await request(app)
    .post(`/accounts/${accountId}/transactions`)
    .set("Idempotency-Key", "retry-1")
    .send(body);

  assert.equal(first.status, 201);
  assert.equal(retry.status, 201);
  assert.equal(retry.body.id, first.body.id);

  const balance = await request(app).get(`/accounts/${accountId}/balance`);
  assert.equal(balance.body.balance, 100);

  const transactions = await request(app).get(
    `/accounts/${accountId}/transactions`
  );
  assert.equal(transactions.body.transactions.length, 1);
});

test("reusing an Idempotency-Key with different transaction parameters returns 409", async () => {
  const app = createApp();
  const accountId = await createAccount(app);

  await request(app)
    .post(`/accounts/${accountId}/transactions`)
    .set("Idempotency-Key", "retry-1")
    .send({ type: "deposit", amount: 100 });
  const res = await request(app)
    .post(`/accounts/${accountId}/transactions`)
    .set("Idempotency-Key", "retry-1")
    .send({ type: "deposit", amount: 50 });

  assert.equal(res.status, 409);
});

test("GET /accounts/:accountId/balance reflects recorded transactions", async () => {
  const app = createApp();
  const accountId = await createAccount(app);
  await request(app)
    .post(`/accounts/${accountId}/transactions`)
    .send({ type: "deposit", amount: 50 });

  const res = await request(app).get(`/accounts/${accountId}/balance`);
  assert.equal(res.status, 200);
  assert.equal(res.body.balance, 50);
});

test("GET /accounts/:accountId/transactions returns recorded history in order", async () => {
  const app = createApp();
  const accountId = await createAccount(app);
  await request(app)
    .post(`/accounts/${accountId}/transactions`)
    .send({ type: "deposit", amount: 50 });
  await request(app)
    .post(`/accounts/${accountId}/transactions`)
    .send({ type: "withdrawal", amount: 20 });

  const res = await request(app).get(`/accounts/${accountId}/transactions`);
  assert.equal(res.status, 200);
  assert.equal(res.body.transactions.length, 2);
  assert.equal(res.body.transactions[0].type, "deposit");
  assert.equal(res.body.transactions[1].type, "withdrawal");
});

test("GET /accounts/:accountId/transactions paginates with limit and startingAfter", async () => {
  const app = createApp();
  const accountId = await createAccount(app);
  for (let amount = 1; amount <= 3; amount++) {
    await request(app)
      .post(`/accounts/${accountId}/transactions`)
      .send({ type: "deposit", amount });
  }

  const firstPage = await request(app).get(
    `/accounts/${accountId}/transactions?limit=2`
  );
  assert.equal(firstPage.status, 200);
  assert.deepEqual(
    firstPage.body.transactions.map((tx: { amount: number }) => tx.amount),
    [1, 2]
  );
  assert.equal(firstPage.body.hasMore, true);

  const lastId =
    firstPage.body.transactions[firstPage.body.transactions.length - 1].id;
  const secondPage = await request(app).get(
    `/accounts/${accountId}/transactions?limit=2&startingAfter=${lastId}`
  );
  assert.equal(secondPage.status, 200);
  assert.deepEqual(
    secondPage.body.transactions.map((tx: { amount: number }) => tx.amount),
    [3]
  );
  assert.equal(secondPage.body.hasMore, false);
});

test("GET /accounts/:accountId/transactions rejects an invalid limit with 400", async () => {
  const app = createApp();
  const accountId = await createAccount(app);

  const res = await request(app).get(
    `/accounts/${accountId}/transactions?limit=not-a-number`
  );
  assert.equal(res.status, 400);
});

test("GET /accounts/:accountId/transactions rejects an unknown startingAfter with 400", async () => {
  const app = createApp();
  const accountId = await createAccount(app);

  const res = await request(app).get(
    `/accounts/${accountId}/transactions?startingAfter=does-not-exist`
  );
  assert.equal(res.status, 400);
});

test("transactions on one account do not affect another account's balance or history", async () => {
  const app = createApp();
  const accountA = await createAccount(app);
  const accountB = await createAccount(app);

  await request(app)
    .post(`/accounts/${accountA}/transactions`)
    .send({ type: "deposit", amount: 100 });

  const balanceA = await request(app).get(`/accounts/${accountA}/balance`);
  const balanceB = await request(app).get(`/accounts/${accountB}/balance`);
  const transactionsB = await request(app).get(
    `/accounts/${accountB}/transactions`
  );

  assert.equal(balanceA.body.balance, 100);
  assert.equal(balanceB.body.balance, 0);
  assert.equal(transactionsB.body.transactions.length, 0);
});

test("unknown routes return a JSON 404", async () => {
  const app = createApp();
  const res = await request(app).get("/nope");

  assert.equal(res.status, 404);
  assert.match(res.headers["content-type"], /json/);
  assert.equal(res.body.error, "Not found");
});

test("malformed JSON bodies return a JSON 400, not the default HTML error page", async () => {
  const app = createApp();
  const accountId = await createAccount(app);

  const res = await request(app)
    .post(`/accounts/${accountId}/transactions`)
    .set("Content-Type", "application/json")
    .send("{not valid json");

  assert.equal(res.status, 400);
  assert.match(res.headers["content-type"], /json/);
});
