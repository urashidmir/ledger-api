export type TransactionType = "deposit" | "withdrawal";

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  balanceAfter: number;
  description?: string;
  timestamp: string;
  /** Client-supplied key that made this transaction's creation idempotent, if any. */
  idempotencyKey?: string;
}
