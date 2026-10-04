import { prisma } from "@lib/prisma.js";

export const UserService = {
    async getAll() {
        return await prisma.user.findMany();
    },

    async getById(id: number) {
        return await prisma.user.findUnique({
            where: { id },
        });
    },

    async create(data: any) {
        return await prisma.user.create({
            data,
        });
    },

    async update(id: number, data: any) {
        return await prisma.user.update({
            where: { id },
            data,
        });
    },

    async delete(id: number) {
        return await prisma.user.delete({
            where: { id },
        });
    },
};
