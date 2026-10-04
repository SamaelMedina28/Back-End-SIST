import { Router, type NextFunction, type Request, type Response, type Router as ExpressRouter } from "express";
import { Role } from "../../../generated/prisma/client.js";
import type { AppConfig } from "../../config/env.js";
import { createAuthMiddleware } from "../../middlewares/auth.middleware.js";
import { requireRole } from "../../middlewares/rbac.middleware.js";
import { validate } from "../../middlewares/validate.middleware.js";
import type { UserRepository } from "../auth/auth.types.js";
import { SessionService } from "../auth/session.service.js";
import {
    categoriesQuerySchema,
    categoryIdForSubcategoryParamsSchema,
    categoryIdParamsSchema,
    createCategorySchema,
    createSubcategorySchema,
    subcategoryIdParamsSchema,
    updateCategorySchema,
    updateSubcategorySchema,
} from "./category.schema.js";
import { CategoryController } from "./category.controller.js";

function requireAdminForInactive(req: Request, _res: Response, next: NextFunction): void {
    const query = req.query as { includeInactive?: boolean };
    if (query.includeInactive === true) {
        requireRole(Role.ADMIN)(req, _res, next);
        return;
    }
    next();
}

export function createCategoryRouter(input: {
    controller: CategoryController;
    users: UserRepository;
    sessions: SessionService;
    config: AppConfig;
}): ExpressRouter {
    const router = Router();
    const authenticate = createAuthMiddleware(input.users, input.sessions, input.config);
    const admin = requireRole(Role.ADMIN);

    router.get(
        "/",
        authenticate,
        validate({ query: categoriesQuerySchema }),
        requireAdminForInactive,
        input.controller.list,
    );
    router.post("/", authenticate, admin, validate(createCategorySchema), input.controller.create);
    router.patch(
        "/:id",
        authenticate,
        admin,
        validate({ params: categoryIdParamsSchema, body: updateCategorySchema }),
        input.controller.update,
    );
    router.delete(
        "/:id",
        authenticate,
        admin,
        validate({ params: categoryIdParamsSchema }),
        input.controller.deactivate,
    );
    router.post(
        "/:categoryId/subcategories",
        authenticate,
        admin,
        validate({ params: categoryIdForSubcategoryParamsSchema, body: createSubcategorySchema }),
        input.controller.createSubcategory,
    );

    return router;
}

export function createSubcategoryRouter(input: {
    controller: CategoryController;
    users: UserRepository;
    sessions: SessionService;
    config: AppConfig;
}): ExpressRouter {
    const router = Router();
    const authenticate = createAuthMiddleware(input.users, input.sessions, input.config);
    const admin = requireRole(Role.ADMIN);

    router.patch(
        "/:id",
        authenticate,
        admin,
        validate({ params: subcategoryIdParamsSchema, body: updateSubcategorySchema }),
        input.controller.updateSubcategory,
    );
    router.delete(
        "/:id",
        authenticate,
        admin,
        validate({ params: subcategoryIdParamsSchema }),
        input.controller.deactivateSubcategory,
    );

    return router;
}
