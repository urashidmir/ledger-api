import { Router } from "express";
import { Ledger } from "../ledger";
import { balanceRouter } from "./balance";
import { transactionsRouter } from "./transactions";

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

  router.use("/:accountId/balance", balanceRouter(ledger));
  router.use("/:accountId/transactions", transactionsRouter(ledger));

  return router;
}
