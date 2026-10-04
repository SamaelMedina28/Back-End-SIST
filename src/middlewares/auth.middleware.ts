import type { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { AuthenticatedRequest } from "../types/generics.js";

export function authMiddleware(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
) {
    // 1. Obtener el token desde Cookie O desde el Header Authorization
    const tokenFromCookie = req.cookies?.jwt;
    const authHeader = req.headers.authorization;
    const tokenFromHeader = authHeader && authHeader.startsWith("Bearer ")
        ? authHeader.split(" ")[1]
        : null;

    const token = tokenFromCookie || tokenFromHeader;

    if (!token) {
        return res.status(401).json({ message: "Acceso denegado. No se proporcionó token de autenticación." });
    }

    try {
        // 2. Verificar token con la clave secreta
        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET || "default_secret"
        ) as { id: number; email: string };

        // 3. Adjuntar datos del usuario al objeto Request
        req.user = decoded;

        next(); // Continuar a la ruta protegida
    } catch (err) {
        return res.status(403).json({ message: "Token inválido o expirado" });
    }
}