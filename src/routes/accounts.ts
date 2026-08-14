import { Router } from "express";
import { Ledger } from "../ledger";
import { createBalanceRouter } from "./balance";
import { createTransactionsRouter } from "./transactions";

export function createAccountsRouter(ledger: Ledger): Router {
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

  router.use("/:accountId/balance", createBalanceRouter(ledger));
  router.use("/:accountId/transactions", createTransactionsRouter(ledger));

  return router;
}
