export function generateRoutes(modelName: string): string {
    const modelLower = modelName.charAt(0).toLowerCase() + modelName.slice(1);

    return `import { Router } from "express";
import { ${modelName}Controller } from "./${modelLower}.controller.js";
import { create${modelName}Schema, update${modelName}Schema } from "./${modelLower}.schema.js";
import { validate } from "@middlewares/validate.middleware.js";

const router: Router = Router();

router.get("/", ${modelName}Controller.index);
router.get("/:id", ${modelName}Controller.getById);
router.post("/", validate(create${modelName}Schema), ${modelName}Controller.store);
router.put("/:id", validate(update${modelName}Schema), ${modelName}Controller.update);
router.delete("/:id", ${modelName}Controller.delete);

export default router;
`;
}
