export function generateService(modelName: string): string {
    const model = modelName;
    const modelLower = modelName.charAt(0).toLowerCase() + modelName.slice(1);

    return `import { prisma } from "@lib/prisma.js";

// En caso de tener error al momento de llamar a prisma.modelo, hacer prisma migrate dev y prisma generate para que prisma detecte el modelo

export const ${model}Service = {
    async getAll() {
        return await prisma.${modelLower}.findMany();
    },

    async getById(id: number) {
        return await prisma.${modelLower}.findUnique({
            where: { id },
        });
    },

    async create(data: any) {
        return await prisma.${modelLower}.create({
            data,
        });
    },

    async update(id: number, data: any) {
        return await prisma.${modelLower}.update({
            where: { id },
            data,
        });
    },

    async delete(id: number) {
        return await prisma.${modelLower}.delete({
            where: { id },
        });
    },
};
`;
}
