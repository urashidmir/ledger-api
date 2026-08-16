import { Router } from "express";
import { Ledger } from "../ledger";

export function balanceRouter(ledger: Ledger): Router {
  const router = Router({ mergeParams: true });

  router.get<{ accountId: string }>("/", (req, res) => {
    res.json({ balance: ledger.getBalance(req.params.accountId) });
  });

  return router;
}
