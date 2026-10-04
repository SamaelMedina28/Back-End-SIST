import { prisma } from "@lib/prisma.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export const AuthService = {
    async register(data: { email: string; password: string; name?: string }) {
        // 1. Verificar si el usuario ya existe
        const existingUser = await prisma.user.findUnique({
            where: { email: data.email },
        });

        if (existingUser) {
            throw new Error("El correo electrónico ya está registrado");
        }

        // 2. Encriptar contraseña
        const hashedPassword = await bcrypt.hash(data.password, 10);

        // 3. Crear usuario (Usando nullish coalescing para convertir undefined a null o usar objeto condicional)
        const user = await prisma.user.create({
            data: {
                email: data.email,
                password: hashedPassword,
                ...(data.name && { name: data.name }),
            },
        });

        // 4. Retornar datos sin la contraseña
        const { password, ...userWithoutPassword } = user;
        return userWithoutPassword;
    },

    async login(data: { email: string; password: string }) {
        // 1. Buscar usuario
        const user = await prisma.user.findUnique({
            where: { email: data.email },
        });

        if (!user) {
            throw new Error("Credenciales inválidas");
        }

        // 2. Validar contraseña
        const isPasswordValid = await bcrypt.compare(
            data.password,
            user.password,
        );
        if (!isPasswordValid) {
            throw new Error("Credenciales inválidas");
        }

        // 3. Generar Token JWT
        const token = jwt.sign(
            { id: user.id, email: user.email },
            process.env.JWT_SECRET || "default_secret",
            { expiresIn: "1d" },
        );

        const { password, ...userWithoutPassword } = user;
        return { user: userWithoutPassword, token };
    },
};
