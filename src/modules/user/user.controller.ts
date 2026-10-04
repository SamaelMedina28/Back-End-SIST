import type { Request, Response, NextFunction } from "express";
import { UserService } from "./user.service.js";

export const UserController = {
    async index(req: Request, res: Response, next: NextFunction) {
        try {
            const users = await UserService.getAll();
            res.json(users);
        } catch (err) {
            next(err);
        }
    },

    async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const user = await UserService.getById(Number(req.params.id));
            if (!user) {
                return res.status(404).json({ message: "User not found" });
            }
            res.json(user);
        } catch (err) {
            next(err);
        }
    },

    async store(req: Request, res: Response, next: NextFunction) {
        try {
            const user = await UserService.create(req.body);
            res.status(201).json(user);
        } catch (err) {
            next(err);
        }
    },

    async update(req: Request, res: Response, next: NextFunction) {
        try {
            const user = await UserService.update(Number(req.params.id), req.body);
            res.json(user);
        } catch (err) {
            next(err);
        }
    },

    async delete(req: Request, res: Response, next: NextFunction) {
        try {
            await UserService.delete(Number(req.params.id));
            res.status(204).send();
        } catch (err) {
            next(err);
        }
    },
};
