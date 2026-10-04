import type { Request, Response } from "express";
import { AppError } from "../../common/errors/app-error.js";
import { sendSuccess } from "../../common/http/response.js";
import { toPublicUser } from "../auth/user.mapper.js";
import type { UpdateProfileInput } from "./user.schema.js";
import { UserService } from "./user.service.js";

export class UserController {
    constructor(private readonly users: UserService) {}

    updateMe = async (req: Request, res: Response): Promise<void> => {
        if (!req.user) {
            throw new AppError(401, "AUTHENTICATION_REQUIRED", "Debes iniciar sesión.");
        }
        const user = await this.users.updateProfile(req.user.id, req.body as UpdateProfileInput);
        sendSuccess(res, toPublicUser(user));
    };
}

