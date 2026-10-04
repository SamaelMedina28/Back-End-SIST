import type { NextFunction, Request, Response } from "express";
import { ZodError, type ZodType } from "zod";
import { AppError, type ErrorFields } from "../common/errors/app-error.js";

interface RequestSchema {
    body?: ZodType;
    query?: ZodType;
    params?: ZodType;
}

function toFields(error: ZodError): ErrorFields {
    return error.issues.reduce<ErrorFields>((fields, issue) => {
        const key = issue.path.join(".") || "body";
        fields[key] ??= [];
        fields[key].push(issue.message);
        return fields;
    }, {});
}

export function validate(schema: RequestSchema | ZodType) {
    return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
        try {
            if ("parseAsync" in schema) {
                req.body = await schema.parseAsync(req.body);
            } else {
                if (schema.body) req.body = await schema.body.parseAsync(req.body);
                if (schema.query) Object.assign(req.query, await schema.query.parseAsync(req.query));
                if (schema.params) Object.assign(req.params, await schema.params.parseAsync(req.params));
            }
            next();
        } catch (error) {
            if (error instanceof ZodError) {
                next(new AppError(422, "VALIDATION_ERROR", "Hay datos inválidos.", toFields(error)));
                return;
            }
            next(error);
        }
    };
}
