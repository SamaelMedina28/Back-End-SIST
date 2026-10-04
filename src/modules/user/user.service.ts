import { AppError } from "../../common/errors/app-error.js";
import type { UserRepository } from "../auth/auth.types.js";
import type { UpdateProfileInput } from "./user.schema.js";

export class UserService {
    constructor(private readonly users: UserRepository) {}

    async updateProfile(userId: string, input: UpdateProfileInput) {
        const user = await this.users.findById(userId);
        if (!user) {
            throw new AppError(401, "INVALID_SESSION", "La sesión no es válida o expiró.");
        }
        if (!user.isActive) {
            throw new AppError(403, "USER_DISABLED", "La cuenta está desactivada.");
        }

        return this.users.updateProfile(userId, {
            ...(input.fullName !== undefined ? { fullName: input.fullName } : {}),
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
        });
    }
}

