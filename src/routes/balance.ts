import { Router } from "express";
import { Ledger } from "../ledger";

export function createBalanceRouter(ledger: Ledger): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json({ balance: ledger.getBalance() });
  });

  return router;
}
