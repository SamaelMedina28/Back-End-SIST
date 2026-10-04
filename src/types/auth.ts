import type { CommunityType, Role, SupportArea } from "../../generated/prisma/client.js";

export interface AuthenticatedUser {
    id: string;
    email: string;
    fullName: string;
    institutionalId: string;
    phone: string | null;
    role: Role;
    communityType: CommunityType;
    supportAreas: SupportArea[];
    skills: string[];
    avatarUrl: string | null;
    isActive: boolean;
}

export interface SessionClaims {
    sub: string;
    email: string;
    purpose: "session";
}

export interface OnboardingClaims {
    googleSubject: string;
    email: string;
    fullName: string;
    avatarUrl: string | null;
    purpose: "onboarding";
}

