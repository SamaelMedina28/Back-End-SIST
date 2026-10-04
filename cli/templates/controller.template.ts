export function generateController(modelName: string): string {
    const model = modelName;
    const modelLower = modelName.charAt(0).toLowerCase() + modelName.slice(1);

    return `import type { Request, Response, NextFunction } from "express";
import { ${model}Service } from "@src/modules/${modelLower}/${modelLower}.service.js";

export const ${model}Controller = {
    async index(req: Request, res: Response, next: NextFunction) {
        try {
            const ${modelLower}s = await ${model}Service.getAll();
            res.json(${modelLower}s);
        } catch (err) {
            next(err);
        }
    },

    async getById(req: Request, res: Response, next: NextFunction) {
        try {
            const ${modelLower} = await ${model}Service.getById(Number(req.params.id));
            if (!${modelLower}) {
                return res.status(404).json({ message: "${model} not found" });
            }
            res.json(${modelLower});
        } catch (err) {
            next(err);
        }
    },

    async store(req: Request, res: Response, next: NextFunction) {
        try {
            const ${modelLower} = await ${model}Service.create(req.body);
            res.status(201).json(${modelLower});
        } catch (err) {
            next(err);
        }
    },

    async update(req: Request, res: Response, next: NextFunction) {
        try {
            const ${modelLower} = await ${model}Service.update(Number(req.params.id), req.body);
            res.json(${modelLower});
        } catch (err) {
            next(err);
        }
    },

    async delete(req: Request, res: Response, next: NextFunction) {
        try {
            await ${model}Service.delete(Number(req.params.id));
            res.status(204).send();
        } catch (err) {
            next(err);
        }
    },
};
`;
}
