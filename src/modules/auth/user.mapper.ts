import type { AuthenticatedUser } from "../../types/auth.js";
import type { UserEntity } from "./auth.types.js";

export function toAuthenticatedUser(user: UserEntity): AuthenticatedUser {
    return {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        institutionalId: user.institutionalId,
        phone: user.phone,
        role: user.role,
        communityType: user.communityType,
        supportAreas: user.supportAreas,
        skills: user.skills,
        avatarUrl: user.avatarUrl,
        isActive: user.isActive,
    };
}

export function toPublicUser(user: UserEntity) {
    const { isActive: _isActive, ...publicUser } = toAuthenticatedUser(user);
    return publicUser;
}

