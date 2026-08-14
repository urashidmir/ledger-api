import { randomUUID } from "crypto";
import { Transaction, TransactionType } from "./types";

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

export interface LedgerOptions {
  /** Maximum number of transactions retained in history; oldest are evicted once exceeded. */
  maxHistory?: number;
  /** Maximum length of a transaction's description. */
  maxDescriptionLength?: number;
}

const DEFAULT_MAX_HISTORY = 10_000;
const DEFAULT_MAX_DESCRIPTION_LENGTH = 500;

export class Ledger {
  private balance = 0;
  private readonly maxHistory: number;
  private readonly maxDescriptionLength: number;

  // Fixed-size ring buffer: history[i] wraps at maxHistory, historyStart is
  // the index of the oldest retained transaction, historyCount how many
  // slots are currently populated. This keeps both inserts and evictions
  // O(1), regardless of how large maxHistory is.
  private readonly history: Transaction[];
  private historyStart = 0;
  private historyCount = 0;

  constructor(options: LedgerOptions = {}) {
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
    description?: string
  ): Transaction {
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

    if (type === "withdrawal" && amount > this.balance) {
      throw new InsufficientFundsError();
    }

    this.balance += type === "deposit" ? amount : -amount;

    const transaction: Transaction = {
      id: randomUUID(),
      type,
      amount,
      balanceAfter: this.balance,
      description,
      timestamp: new Date().toISOString(),
    };

    this.pushToHistory(transaction);
    return transaction;
  }

  getBalance(): number {
    return this.balance;
  }

  getTransactions(): Transaction[] {
    const result: Transaction[] = new Array(this.historyCount);
    for (let i = 0; i < this.historyCount; i++) {
      result[i] = this.history[(this.historyStart + i) % this.maxHistory];
    }
    return result;
  }

  private pushToHistory(transaction: Transaction): void {
    const index = (this.historyStart + this.historyCount) % this.maxHistory;
    this.history[index] = transaction;

    if (this.historyCount < this.maxHistory) {
      this.historyCount++;
    } else {
      // Buffer is full: the slot we just overwrote was the oldest entry,
      // so the new oldest is the next one along.
      this.historyStart = (this.historyStart + 1) % this.maxHistory;
    }
  }
}
