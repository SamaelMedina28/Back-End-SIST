export function generateMiddleware(name: string): string {
    const nameLower = name.charAt(0).toLowerCase() + name.slice(1);

    return `import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/generics.js";



export function ${nameLower}Middleware(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    try {
        // TODO: Lógica del middleware ${name}
        console.log("Middleware ${name} ejecutado");
        next();
    } catch (err) {
        next(err);
    }
}
`;
}