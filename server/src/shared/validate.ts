import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny } from "zod";

// Wraps a Zod schema as Express middleware. Parsed/coerced values replace
// the raw input so downstream handlers only ever see validated data -
// consistent with SRS-056 ("client-calculated ... fields shall be treated
// as untrusted input and independently checked").
export function validateBody(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.body = schema.parse(req.body);
    next();
  };
}

export function validateQuery(schema: ZodTypeAny) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.query = schema.parse(req.query);
    next();
  };
}
