import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError } from "../common/errors/app-error.js";
import { logger } from "../common/logger.js";

export const notFoundMiddleware: RequestHandler = (req, _res, next) => {
    next(new AppError(404, "ROUTE_NOT_FOUND", "La ruta solicitada no existe."));
};

export const errorMiddleware: ErrorRequestHandler = (error: unknown, req, res, _next) => {
    const appError = error instanceof AppError
        ? error
        : new AppError(500, "INTERNAL_ERROR", "Ocurrió un error interno.");

    if (!(error instanceof AppError)) {
        const technicalError = error instanceof Error ? error : new Error(String(error));
        logger.error({
            timestamp: new Date().toISOString(),
            requestId: req.requestId,
            message: technicalError.message,
            stack: technicalError.stack,
        }, "unhandled request error");
    }

    res.status(appError.statusCode).json({
        success: false,
        error: {
            code: appError.code,
            message: appError.message,
            ...(appError.fields ? { fields: appError.fields } : {}),
        },
        requestId: req.requestId,
    });
};

