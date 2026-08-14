import { test } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "./app";

test("POST /transactions creates a deposit", async () => {
  const app = createApp();
  const res = await request(app)
    .post("/transactions")
    .send({ type: "deposit", amount: 100, description: "pay" });

  assert.equal(res.status, 201);
  assert.equal(res.body.type, "deposit");
  assert.equal(res.body.balanceAfter, 100);
});

test("POST /transactions rejects an invalid type with 400", async () => {
  const app = createApp();
  const res = await request(app)
    .post("/transactions")
    .send({ type: "bogus", amount: 10 });

  assert.equal(res.status, 400);
});

test("POST /transactions rejects an invalid amount with 400", async () => {
  const app = createApp();
  const res = await request(app)
    .post("/transactions")
    .send({ type: "deposit", amount: -5 });

  assert.equal(res.status, 400);
});

test("POST /transactions rejects an overlong description with 400", async () => {
  const app = createApp();
  const res = await request(app)
    .post("/transactions")
    .send({ type: "deposit", amount: 10, description: "x".repeat(1000) });

  assert.equal(res.status, 400);
});

test("POST /transactions rejects an overdraft with 422 and leaves the balance unchanged", async () => {
  const app = createApp();
  const res = await request(app)
    .post("/transactions")
    .send({ type: "withdrawal", amount: 10 });

  assert.equal(res.status, 422);

  const balance = await request(app).get("/balance");
  assert.equal(balance.body.balance, 0);
});

test("GET /balance reflects recorded transactions", async () => {
  const app = createApp();
  await request(app).post("/transactions").send({ type: "deposit", amount: 50 });

  const res = await request(app).get("/balance");
  assert.equal(res.status, 200);
  assert.equal(res.body.balance, 50);
});

test("GET /transactions returns recorded history in order", async () => {
  const app = createApp();
  await request(app).post("/transactions").send({ type: "deposit", amount: 50 });
  await request(app).post("/transactions").send({ type: "withdrawal", amount: 20 });

  const res = await request(app).get("/transactions");
  assert.equal(res.status, 200);
  assert.equal(res.body.transactions.length, 2);
  assert.equal(res.body.transactions[0].type, "deposit");
  assert.equal(res.body.transactions[1].type, "withdrawal");
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
  const res = await request(app)
    .post("/transactions")
    .set("Content-Type", "application/json")
    .send("{not valid json");

  assert.equal(res.status, 400);
  assert.match(res.headers["content-type"], /json/);
});
