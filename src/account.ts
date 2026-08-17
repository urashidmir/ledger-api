import { randomUUID } from "crypto";
import { Decimal } from "decimal.js";
import type { Transaction, TransactionType } from "./types";

export class InsufficientFundsError extends Error {
  constructor() {
    super("Withdrawal amount exceeds current balance");
    this.name = "InsufficientFundsError";
  }
}

export class InvalidAmountError extends Error {
  constructor() {
    super("Amount must be a finite number greater than 0");
    this.name = "InvalidAmountError";
  }
}

export class InvalidDescriptionError extends Error {
  constructor(maxLength: number) {
    super(`Description must be a string of at most ${maxLength} characters`);
    this.name = "InvalidDescriptionError";
  }
}

export class InvalidIdempotencyKeyError extends Error {
  constructor() {
    super("Idempotency-Key must be a non-empty string");
    this.name = "InvalidIdempotencyKeyError";
  }
}

export class IdempotencyKeyConflictError extends Error {
  constructor(idempotencyKey: string) {
    super(
      `Idempotency-Key "${idempotencyKey}" was already used with different transaction parameters`,
    );
    this.name = "IdempotencyKeyConflictError";
  }
}

export class InvalidPaginationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPaginationError";
  }
}

export interface AccountOptions {
  /** Maximum number of transactions retained in history; oldest are evicted once exceeded. */
  maxHistory?: number;
  /** Maximum length of a transaction's description. */
  maxDescriptionLength?: number;
}

export interface GetTransactionsOptions {
  /** Maximum number of transactions to return; defaults to 50, capped at 200. */
  limit?: number;
  /** Return only transactions recorded after this transaction id. */
  startingAfter?: string;
}

export interface TransactionPage {
  transactions: Transaction[];
  /** Whether another page is available by passing the last transaction's id as `startingAfter`. */
  hasMore: boolean;
}

const DEFAULT_MAX_HISTORY = 10_000;
const DEFAULT_MAX_DESCRIPTION_LENGTH = 500;
const DEFAULT_TRANSACTIONS_LIMIT = 50;
const MAX_TRANSACTIONS_LIMIT = 200;

/** A single account's balance and transaction history. */
export class Account {
  readonly createdAt: string = new Date().toISOString();
  // Tracked as an arbitrary-precision Decimal, not a number, so that
  // successive deposits/withdrawals never accumulate IEEE-754 binary
  // floating-point error (e.g. 0.1 + 0.2 === 0.30000000000000004) —
  // decimal.js does base-10 arithmetic, so there's no representation noise
  // to round away in the first place. Converted to a number only at the
  // public API boundary (getBalance, balanceAfter).
  private balance = new Decimal(0);
  private readonly maxHistory: number;
  private readonly maxDescriptionLength: number;

  // Fixed-size ring buffer: history[i] wraps at maxHistory, historyStart is
  // the index of the oldest retained transaction, historyCount how many
  // slots are currently populated. This keeps both inserts and evictions
  // O(1), regardless of how large maxHistory is.
  private readonly history: Transaction[];
  private historyStart = 0;
  private historyCount = 0;

  // Maps an idempotency key to the transaction it originally created, so a
  // retried request with the same key can return that transaction instead of
  // recording a duplicate. An entry is removed the moment its transaction is
  // evicted from history, so this map never outgrows the ring buffer above.
  private readonly idempotencyKeys = new Map<string, Transaction>();

  constructor(options: AccountOptions = {}) {
    const maxHistory = options.maxHistory ?? DEFAULT_MAX_HISTORY;
    if (!Number.isInteger(maxHistory) || maxHistory <= 0) {
      throw new RangeError("maxHistory must be a positive integer");
    }

    this.maxHistory = maxHistory;
    this.maxDescriptionLength =
      options.maxDescriptionLength ?? DEFAULT_MAX_DESCRIPTION_LENGTH;
    this.history = new Array(maxHistory);
  }

  recordTransaction(
    type: TransactionType,
    amount: number,
    description?: string,
    idempotencyKey?: string,
  ): Transaction {
    if (idempotencyKey !== undefined) {
      if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0) {
        throw new InvalidIdempotencyKeyError();
      }

      const existing = this.idempotencyKeys.get(idempotencyKey);
      if (existing) {
        if (
          existing.type !== type ||
          existing.amount !== amount ||
          existing.description !== description
        ) {
          throw new IdempotencyKeyConflictError(idempotencyKey);
        }
        return existing;
      }
    }

    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      throw new InvalidAmountError();
    }

    if (
      description !== undefined &&
      (typeof description !== "string" ||
        description.length > this.maxDescriptionLength)
    ) {
      throw new InvalidDescriptionError(this.maxDescriptionLength);
    }

    if (
      type === "withdrawal" &&
      new Decimal(amount).greaterThan(this.balance)
    ) {
      throw new InsufficientFundsError();
    }

    this.balance =
      type === "deposit"
        ? this.balance.plus(amount)
        : this.balance.minus(amount);

    const transaction: Transaction = {
      id: randomUUID(),
      type,
      amount,
      balanceAfter: this.balance.toNumber(),
      description,
      createdAt: new Date().toISOString(),
      idempotencyKey,
    };

    this.pushToHistory(transaction);

    if (idempotencyKey !== undefined) {
      this.idempotencyKeys.set(idempotencyKey, transaction);
    }

    return transaction;
  }

  getBalance(): number {
    return this.balance.toNumber();
  }

  getTransactions(options: GetTransactionsOptions = {}): TransactionPage {
    const limit = this.normalizeLimit(options.limit);
    const offset = this.resolveStartOffset(options.startingAfter);

    const count = Math.max(0, Math.min(limit, this.historyCount - offset));
    const transactions: Transaction[] = new Array(count);
    for (let i = 0; i < count; i++) {
      transactions[i] =
        this.history[(this.historyStart + offset + i) % this.maxHistory];
    }

    return { transactions, hasMore: offset + count < this.historyCount };
  }

  private normalizeLimit(limit: number | undefined): number {
    if (limit === undefined) {
      return DEFAULT_TRANSACTIONS_LIMIT;
    }
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new InvalidPaginationError("limit must be a positive integer");
    }
    return Math.min(limit, MAX_TRANSACTIONS_LIMIT);
  }

  /** Returns the ring-buffer offset just past the transaction matching `startingAfter`. */
  private resolveStartOffset(startingAfter: string | undefined): number {
    if (startingAfter === undefined) {
      return 0;
    }
    for (let i = 0; i < this.historyCount; i++) {
      if (
        this.history[(this.historyStart + i) % this.maxHistory].id ===
        startingAfter
      ) {
        return i + 1;
      }
    }
    throw new InvalidPaginationError(
      `startingAfter transaction "${startingAfter}" was not found in this account's history`,
    );
  }

  private pushToHistory(transaction: Transaction): void {
    const index = (this.historyStart + this.historyCount) % this.maxHistory;
    const isFull = this.historyCount === this.maxHistory;
    const evicted = isFull ? this.history[index] : undefined;
    this.history[index] = transaction;

    if (!isFull) {
      this.historyCount++;
    } else {
      // Buffer is full: the slot we just overwrote was the oldest entry,
      // so the new oldest is the next one along.
      this.historyStart = (this.historyStart + 1) % this.maxHistory;
    }

    if (evicted?.idempotencyKey !== undefined) {
      this.idempotencyKeys.delete(evicted.idempotencyKey);
    }
  }
}
