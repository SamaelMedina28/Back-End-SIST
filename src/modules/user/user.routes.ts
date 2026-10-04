import { Router, type Router as ExpressRouter } from "express";
import { UserController } from "./user.controller.js";
import { authMiddleware } from "@src/middlewares/auth.middleware.js";

const router: ExpressRouter = Router();

router.get("/", authMiddleware, UserController.index);
router.get("/:id", authMiddleware, UserController.getById);

export default router;