import { Router } from "express";
import { Ledger } from "../ledger";
import { TransactionType } from "../types";

export function createTransactionsRouter(ledger: Ledger): Router {
  const router = Router();

  router.post("/", (req, res) => {
    const { type, amount, description } = req.body ?? {};

    if (type !== "deposit" && type !== "withdrawal") {
      return res
        .status(400)
        .json({ error: 'type must be either "deposit" or "withdrawal"' });
    }

    const transaction = ledger.recordTransaction(
      type as TransactionType,
      amount,
      description
    );
    res.status(201).json(transaction);
  });

  router.get("/", (_req, res) => {
    res.json({ transactions: ledger.getTransactions() });
  });

  return router;
}
