import { Router } from "express";
import { Ledger } from "../ledger";
import { TransactionType } from "../types";

export function accountsRouter(ledger: Ledger): Router {
  const router = Router();

  router.post("/", (_req, res) => {
    res.status(201).json(ledger.createAccount());
  });

  router.get("/", (_req, res) => {
    res.json({ accounts: ledger.listAccounts() });
  });

  router.get("/:accountId", (req, res) => {
    res.json(ledger.getAccountSummary(req.params.accountId));
  });

  router.get("/:accountId/balance", (req, res) => {
    res.json({ balance: ledger.getBalance(req.params.accountId) });
  });

  router.post("/:accountId/transactions", (req, res) => {
    const { accountId } = req.params;
    const { type, amount, description } = req.body ?? {};

    if (type !== "deposit" && type !== "withdrawal") {
      return res
        .status(400)
        .json({ error: 'type must be either "deposit" or "withdrawal"' });
    }

    const idempotencyKey = req.headers["idempotency-key"];
    if (Array.isArray(idempotencyKey)) {
      return res
        .status(400)
        .json({ error: "Idempotency-Key header must not be repeated" });
    }

    const transaction = ledger.recordTransaction(
      accountId,
      type as TransactionType,
      amount,
      description,
      idempotencyKey
    );
    res.status(201).json(transaction);
  });

  router.get("/:accountId/transactions", (req, res) => {
    const { accountId } = req.params;
    const { limit: limitParam, startingAfter: startingAfterParam } = req.query;

    if (Array.isArray(limitParam) || Array.isArray(startingAfterParam)) {
      return res
        .status(400)
        .json({ error: "limit and startingAfter must not be repeated" });
    }

    const limit = typeof limitParam === "string" ? Number(limitParam) : undefined;
    const startingAfter =
      typeof startingAfterParam === "string" ? startingAfterParam : undefined;

    res.json(ledger.getTransactions(accountId, { limit, startingAfter }));
  });

  return router;
}
