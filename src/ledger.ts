import { randomUUID } from "crypto";
import {
  Account,
  type AccountOptions,
  type GetTransactionsOptions,
  type TransactionPage,
} from "./account";
import type { Transaction, TransactionType } from "./types";

export class UnknownAccountError extends Error {
  constructor(accountId: string) {
    super(`No account found with id "${accountId}"`);
    this.name = "UnknownAccountError";
  }
}

export interface AccountSummary {
  id: string;
  balance: number;
  createdAt: string;
}

/** A collection of accounts, each with its own balance and transaction history. */
export class Ledger {
  private readonly accounts = new Map<string, Account>();

  constructor(private readonly accountOptions: AccountOptions = {}) {}

  createAccount(): AccountSummary {
    const id = randomUUID();
    const account = new Account(this.accountOptions);
    this.accounts.set(id, account);
    return this.toSummary(id, account);
  }

  listAccounts(): AccountSummary[] {
    return [...this.accounts.entries()].map(([id, account]) =>
      this.toSummary(id, account),
    );
  }

  getAccountSummary(accountId: string): AccountSummary {
    return this.toSummary(accountId, this.getAccountOrThrow(accountId));
  }

  getBalance(accountId: string): number {
    return this.getAccountOrThrow(accountId).getBalance();
  }

  getTransactions(
    accountId: string,
    options: GetTransactionsOptions = {},
  ): TransactionPage {
    return this.getAccountOrThrow(accountId).getTransactions(options);
  }

  recordTransaction(
    accountId: string,
    type: TransactionType,
    amount: number,
    description?: string,
    idempotencyKey?: string,
  ): Transaction {
    return this.getAccountOrThrow(accountId).recordTransaction(
      type,
      amount,
      description,
      idempotencyKey,
    );
  }

  private getAccountOrThrow(accountId: string): Account {
    const account = this.accounts.get(accountId);
    if (!account) {
      throw new UnknownAccountError(accountId);
    }
    return account;
  }

  private toSummary(id: string, account: Account): AccountSummary {
    return { id, balance: account.getBalance(), createdAt: account.createdAt };
  }
}
