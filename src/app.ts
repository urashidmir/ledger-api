import express, { NextFunction, Request, Response } from "express";
import {
  Ledger,
  InsufficientFundsError,
  InvalidAmountError,
  InvalidDescriptionError,
} from "./ledger";
import { createBalanceRouter } from "./routes/balance";
import { createTransactionsRouter } from "./routes/transactions";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "10kb" }));

  const ledger = new Ledger();
  app.use("/transactions", createTransactionsRouter(ledger));
  app.use("/balance", createBalanceRouter(ledger));

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof InvalidAmountError || err instanceof InvalidDescriptionError) {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof InsufficientFundsError) {
      return res.status(422).json({ error: err.message });
    }
    if (err instanceof SyntaxError && "body" in err) {
      return res.status(400).json({ error: "Invalid JSON body" });
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
