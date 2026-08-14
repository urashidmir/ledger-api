import { test } from "node:test";
import assert from "node:assert/strict";
import { Ledger, UnknownAccountError } from "./ledger";
import { InsufficientFundsError } from "./account";

test("createAccount returns a summary with a zero balance and a unique id", () => {
  const ledger = new Ledger();
  const a = ledger.createAccount();
  const b = ledger.createAccount();

  assert.equal(a.balance, 0);
  assert.notEqual(a.id, b.id);
});

test("listAccounts returns every created account", () => {
  const ledger = new Ledger();
  const a = ledger.createAccount();
  const b = ledger.createAccount();

  const ids = ledger.listAccounts().map((account) => account.id);
  assert.deepEqual(new Set(ids), new Set([a.id, b.id]));
});

test("getAccountSummary reflects recorded transactions", () => {
  const ledger = new Ledger();
  const { id } = ledger.createAccount();
  ledger.recordTransaction(id, "deposit", 100);

  assert.equal(ledger.getAccountSummary(id).balance, 100);
});

test("recordTransaction, getBalance and getTransactions scope to the given account", () => {
  const ledger = new Ledger();
  const a = ledger.createAccount();
  const b = ledger.createAccount();

  ledger.recordTransaction(a.id, "deposit", 100);
  ledger.recordTransaction(b.id, "deposit", 5);

  assert.equal(ledger.getBalance(a.id), 100);
  assert.equal(ledger.getBalance(b.id), 5);
  assert.equal(ledger.getTransactions(a.id).transactions.length, 1);
  assert.equal(ledger.getTransactions(b.id).transactions.length, 1);
});

test("a withdrawal on one account cannot draw down another account's balance", () => {
  const ledger = new Ledger();
  const a = ledger.createAccount();
  const b = ledger.createAccount();
  ledger.recordTransaction(a.id, "deposit", 100);

  assert.throws(
    () => ledger.recordTransaction(b.id, "withdrawal", 1),
    InsufficientFundsError
  );
  assert.equal(ledger.getBalance(a.id), 100);
  assert.equal(ledger.getBalance(b.id), 0);
});

test("getBalance, getTransactions and recordTransaction reject an unknown account id", () => {
  const ledger = new Ledger();

  assert.throws(() => ledger.getBalance("missing"), UnknownAccountError);
  assert.throws(() => ledger.getTransactions("missing"), UnknownAccountError);
  assert.throws(
    () => ledger.recordTransaction("missing", "deposit", 10),
    UnknownAccountError
  );
  assert.throws(
    () => ledger.getAccountSummary("missing"),
    UnknownAccountError
  );
});
