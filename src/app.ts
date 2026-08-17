import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  IdempotencyKeyConflictError,
  InsufficientFundsError,
  InvalidAmountError,
  InvalidDescriptionError,
  InvalidIdempotencyKeyError,
  InvalidPaginationError,
} from "./account";
import { Ledger, UnknownAccountError } from "./ledger";
import { accountsRouter } from "./routes/accounts";

export function createApp() {
  const app = express();
  app.use(express.json({ limit: "10kb" }));

  const ledger = new Ledger();
  app.use("/accounts", accountsRouter(ledger));

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (
      err instanceof InvalidAmountError ||
      err instanceof InvalidDescriptionError ||
      err instanceof InvalidIdempotencyKeyError ||
      err instanceof InvalidPaginationError
    ) {
      return res.status(400).json({ error: err.message });
    }
    if (err instanceof InsufficientFundsError) {
      return res.status(422).json({ error: err.message });
    }
    if (err instanceof UnknownAccountError) {
      return res.status(404).json({ error: err.message });
    }
    if (err instanceof IdempotencyKeyConflictError) {
      return res.status(409).json({ error: err.message });
    }
    if (err instanceof SyntaxError && "body" in err) {
      return res.status(400).json({ error: "Invalid JSON body" });
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
