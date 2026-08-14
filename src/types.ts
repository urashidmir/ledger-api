export type TransactionType = "deposit" | "withdrawal";

export interface Transaction {
  id: string;
  type: TransactionType;
  amount: number;
  balanceAfter: number;
  description?: string;
  timestamp: string;
}
