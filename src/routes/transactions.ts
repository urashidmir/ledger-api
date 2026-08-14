import { Router } from "express";
import { Ledger } from "../ledger";
import { TransactionType } from "../types";

export function createTransactionsRouter(ledger: Ledger): Router {
  const router = Router({ mergeParams: true });

  router.post<{ accountId: string }>("/", (req, res) => {
    const { accountId } = req.params;
    const { type, amount, description } = req.body ?? {};

    if (type !== "deposit" && type !== "withdrawal") {
      return res
        .status(400)
        .json({ error: 'type must be either "deposit" or "withdrawal"' });
    }

    const transaction = ledger.recordTransaction(
      accountId,
      type as TransactionType,
      amount,
      description
    );
    res.status(201).json(transaction);
  });

  router.get<{ accountId: string }>("/", (req, res) => {
    res.json({ transactions: ledger.getTransactions(req.params.accountId) });
  });

  return router;
}
