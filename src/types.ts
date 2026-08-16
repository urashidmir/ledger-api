export type TransactionType = "deposit" | "withdrawal";

export interface Transaction {
  readonly id: string;
  readonly type: TransactionType;
  /** Magnitude of the transaction; always positive — direction is implied by `type`. */
  readonly amount: number;
  readonly balanceAfter: number;
  readonly description?: string;
  /** ISO 8601 timestamp of when the transaction was recorded. */
  readonly createdAt: string;
  /** Client-supplied key that made this transaction's creation idempotent, if any. */
  readonly idempotencyKey?: string;
}
