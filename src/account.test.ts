import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Account,
  IdempotencyKeyConflictError,
  InsufficientFundsError,
  InvalidAmountError,
  InvalidDescriptionError,
  InvalidIdempotencyKeyError,
} from "./account";

test("starts with a zero balance and empty history", () => {
  const account = new Account();
  assert.equal(account.getBalance(), 0);
  assert.deepEqual(account.getTransactions(), []);
});

test("deposit increases the balance and records a transaction", () => {
  const account = new Account();
  const tx = account.recordTransaction("deposit", 100, "initial");

  assert.equal(account.getBalance(), 100);
  assert.equal(tx.type, "deposit");
  assert.equal(tx.amount, 100);
  assert.equal(tx.balanceAfter, 100);
  assert.equal(tx.description, "initial");
  assert.equal(account.getTransactions().length, 1);
});

test("withdrawal decreases the balance", () => {
  const account = new Account();
  account.recordTransaction("deposit", 100);
  const tx = account.recordTransaction("withdrawal", 40);

  assert.equal(account.getBalance(), 60);
  assert.equal(tx.balanceAfter, 60);
});

test("rejects a withdrawal that exceeds the balance, leaving the balance unchanged", () => {
  const account = new Account();
  account.recordTransaction("deposit", 10);

  assert.throws(
    () => account.recordTransaction("withdrawal", 20),
    InsufficientFundsError
  );
  assert.equal(account.getBalance(), 10);
  assert.equal(account.getTransactions().length, 1);
});

test("rejects non-positive or non-finite amounts", () => {
  const account = new Account();

  for (const amount of [0, -5, NaN, Infinity, -Infinity]) {
    assert.throws(
      () => account.recordTransaction("deposit", amount),
      InvalidAmountError
    );
  }
  assert.equal(account.getBalance(), 0);
  assert.equal(account.getTransactions().length, 0);
});

test("getTransactions returns a snapshot, not the live internal array", () => {
  const account = new Account();
  account.recordTransaction("deposit", 10);

  const snapshot = account.getTransactions();
  snapshot.push({
    id: "injected",
    type: "deposit",
    amount: 999,
    balanceAfter: 999,
    timestamp: new Date().toISOString(),
  });

  assert.equal(account.getTransactions().length, 1);
});

test("evicts the oldest transactions once history exceeds the configured cap, without affecting the balance", () => {
  const account = new Account({ maxHistory: 3 });
  account.recordTransaction("deposit", 1);
  account.recordTransaction("deposit", 2);
  account.recordTransaction("deposit", 3);
  account.recordTransaction("deposit", 4);

  const history = account.getTransactions();
  assert.equal(history.length, 3);
  assert.equal(history[0].amount, 2);
  assert.equal(history[2].amount, 4);
  assert.equal(account.getBalance(), 10);
});

test("ring buffer stays in chronological order across multiple wraps", () => {
  const account = new Account({ maxHistory: 2 });
  for (let amount = 1; amount <= 7; amount++) {
    account.recordTransaction("deposit", amount);
  }

  const history = account.getTransactions();
  assert.deepEqual(
    history.map((tx) => tx.amount),
    [6, 7]
  );
  assert.equal(account.getBalance(), 28);
});

test("rejects a maxHistory that is not a positive integer", () => {
  assert.throws(() => new Account({ maxHistory: 0 }), RangeError);
  assert.throws(() => new Account({ maxHistory: -1 }), RangeError);
  assert.throws(() => new Account({ maxHistory: 1.5 }), RangeError);
});

test("rejects a description that is not a string, enforced by the account itself", () => {
  const account = new Account();
  assert.throws(
    () => account.recordTransaction("deposit", 10, 123 as unknown as string),
    InvalidDescriptionError
  );
  assert.equal(account.getBalance(), 0);
});

test("rejects a description longer than the configured max, enforced by the account itself", () => {
  const account = new Account({ maxDescriptionLength: 5 });

  assert.throws(
    () => account.recordTransaction("deposit", 10, "123456"),
    InvalidDescriptionError
  );
  assert.equal(account.getBalance(), 0);

  const tx = account.recordTransaction("deposit", 10, "12345");
  assert.equal(tx.description, "12345");
});

test("a retried request with the same idempotency key returns the original transaction, without recording a duplicate", () => {
  const account = new Account();
  const first = account.recordTransaction("deposit", 100, "pay", "key-1");
  const retry = account.recordTransaction("deposit", 100, "pay", "key-1");

  assert.equal(retry.id, first.id);
  assert.equal(account.getBalance(), 100);
  assert.equal(account.getTransactions().length, 1);
});

test("reusing an idempotency key with different parameters is rejected", () => {
  const account = new Account();
  account.recordTransaction("deposit", 100, "pay", "key-1");

  assert.throws(
    () => account.recordTransaction("deposit", 50, "pay", "key-1"),
    IdempotencyKeyConflictError
  );
  assert.equal(account.getBalance(), 100);
  assert.equal(account.getTransactions().length, 1);
});

test("different idempotency keys record independent transactions", () => {
  const account = new Account();
  account.recordTransaction("deposit", 100, undefined, "key-1");
  account.recordTransaction("deposit", 100, undefined, "key-2");

  assert.equal(account.getBalance(), 200);
  assert.equal(account.getTransactions().length, 2);
});

test("rejects an empty idempotency key", () => {
  const account = new Account();
  assert.throws(
    () => account.recordTransaction("deposit", 10, undefined, ""),
    InvalidIdempotencyKeyError
  );
});

test("an evicted transaction's idempotency key can be reused once it falls out of history", () => {
  const account = new Account({ maxHistory: 2 });
  account.recordTransaction("deposit", 1, undefined, "key-1");
  account.recordTransaction("deposit", 2);
  account.recordTransaction("deposit", 3); // evicts the "key-1" transaction

  const tx = account.recordTransaction("deposit", 4, undefined, "key-1");
  assert.equal(tx.amount, 4);
  assert.equal(account.getBalance(), 10);
});
