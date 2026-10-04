import type { Request, Response, NextFunction } from "express";
import { ZodObject, ZodError } from "zod";

interface RequestSchema {
    body?: ZodObject;
    query?: ZodObject;
    params?: ZodObject;
}

export function validate(schema: RequestSchema | ZodObject) {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            // Si le pasas un ZodObject directamente, valida el body
            if ("parseAsync" in schema) {
                req.body = await schema.parseAsync(req.body);
            } else {
                if (schema.body) res.locals.body = await schema.body.parseAsync(req.body);
                if (schema.query) res.locals.query = await schema.query.parseAsync(req.query);
                if (schema.params) res.locals.params = await schema.params.parseAsync(req.params);
            }
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                return res.status(400).json({
                    message: "Error de validación",
                    errors: error.issues.map((e) => ({
                        field: e.path.join("."),
                        message: e.message,
                    })),
                });
            }
            next(error);
        }
    };
}