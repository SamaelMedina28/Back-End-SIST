import type { Request } from "express";

// Extender la interfaz Request de Express para adjuntar el usuario decodificado
export interface AuthenticatedRequest extends Request {
    user?: {
        id: number;
        email: string;
    };
}