import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Ledger,
  InsufficientFundsError,
  InvalidAmountError,
  InvalidDescriptionError,
} from "./ledger";

test("starts with a zero balance and empty history", () => {
  const ledger = new Ledger();
  assert.equal(ledger.getBalance(), 0);
  assert.deepEqual(ledger.getTransactions(), []);
});

test("deposit increases the balance and records a transaction", () => {
  const ledger = new Ledger();
  const tx = ledger.recordTransaction("deposit", 100, "initial");

  assert.equal(ledger.getBalance(), 100);
  assert.equal(tx.type, "deposit");
  assert.equal(tx.amount, 100);
  assert.equal(tx.balanceAfter, 100);
  assert.equal(tx.description, "initial");
  assert.equal(ledger.getTransactions().length, 1);
});

test("withdrawal decreases the balance", () => {
  const ledger = new Ledger();
  ledger.recordTransaction("deposit", 100);
  const tx = ledger.recordTransaction("withdrawal", 40);

  assert.equal(ledger.getBalance(), 60);
  assert.equal(tx.balanceAfter, 60);
});

test("rejects a withdrawal that exceeds the balance, leaving the balance unchanged", () => {
  const ledger = new Ledger();
  ledger.recordTransaction("deposit", 10);

  assert.throws(
    () => ledger.recordTransaction("withdrawal", 20),
    InsufficientFundsError
  );
  assert.equal(ledger.getBalance(), 10);
  assert.equal(ledger.getTransactions().length, 1);
});

test("rejects non-positive or non-finite amounts", () => {
  const ledger = new Ledger();

  for (const amount of [0, -5, NaN, Infinity, -Infinity]) {
    assert.throws(
      () => ledger.recordTransaction("deposit", amount),
      InvalidAmountError
    );
  }
  assert.equal(ledger.getBalance(), 0);
  assert.equal(ledger.getTransactions().length, 0);
});

test("getTransactions returns a snapshot, not the live internal array", () => {
  const ledger = new Ledger();
  ledger.recordTransaction("deposit", 10);

  const snapshot = ledger.getTransactions();
  snapshot.push({
    id: "injected",
    type: "deposit",
    amount: 999,
    balanceAfter: 999,
    timestamp: new Date().toISOString(),
  });

  assert.equal(ledger.getTransactions().length, 1);
});

test("evicts the oldest transactions once history exceeds the configured cap, without affecting the balance", () => {
  const ledger = new Ledger({ maxHistory: 3 });
  ledger.recordTransaction("deposit", 1);
  ledger.recordTransaction("deposit", 2);
  ledger.recordTransaction("deposit", 3);
  ledger.recordTransaction("deposit", 4);

  const history = ledger.getTransactions();
  assert.equal(history.length, 3);
  assert.equal(history[0].amount, 2);
  assert.equal(history[2].amount, 4);
  assert.equal(ledger.getBalance(), 10);
});

test("ring buffer stays in chronological order across multiple wraps", () => {
  const ledger = new Ledger({ maxHistory: 2 });
  for (let amount = 1; amount <= 7; amount++) {
    ledger.recordTransaction("deposit", amount);
  }

  const history = ledger.getTransactions();
  assert.deepEqual(
    history.map((tx) => tx.amount),
    [6, 7]
  );
  assert.equal(ledger.getBalance(), 28);
});

test("rejects a maxHistory that is not a positive integer", () => {
  assert.throws(() => new Ledger({ maxHistory: 0 }), RangeError);
  assert.throws(() => new Ledger({ maxHistory: -1 }), RangeError);
  assert.throws(() => new Ledger({ maxHistory: 1.5 }), RangeError);
});

test("rejects a description that is not a string, enforced by the ledger itself", () => {
  const ledger = new Ledger();
  assert.throws(
    () => ledger.recordTransaction("deposit", 10, 123 as unknown as string),
    InvalidDescriptionError
  );
  assert.equal(ledger.getBalance(), 0);
});

test("rejects a description longer than the configured max, enforced by the ledger itself", () => {
  const ledger = new Ledger({ maxDescriptionLength: 5 });

  assert.throws(
    () => ledger.recordTransaction("deposit", 10, "123456"),
    InvalidDescriptionError
  );
  assert.equal(ledger.getBalance(), 0);

  const tx = ledger.recordTransaction("deposit", 10, "12345");
  assert.equal(tx.description, "12345");
});
