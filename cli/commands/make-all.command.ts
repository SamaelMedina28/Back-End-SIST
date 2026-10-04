import { existsSync, readFileSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import pkg from "@prisma/internals";
const { getDMMF } = pkg;

import { askQuestion } from "../utils/prompt.util.js";
import { generateSchema } from "../templates/schema.template.js";
import { generateController } from "../templates/controller.template.js";
import { generateService } from "../templates/service.template.js";
import { generateRoutes } from "../templates/routes.template.js";

export async function handleMakeAll(rawName: string): Promise<void> {
    const schemaPath = join(process.cwd(), "prisma", "schema.prisma");
    if (!existsSync(schemaPath)) {
        console.error("[ERROR] No se encontró el archivo prisma/schema.prisma");
        process.exit(1);
    }

    const schema = readFileSync(schemaPath, "utf-8");
    const dmmf = await getDMMF({ datamodel: schema });

    const model = dmmf.datamodel.models.find(
        (m) => m.name.toLowerCase() === rawName.toLowerCase()
    );

    if (!model) {
        console.error(`[ERROR] No se encontró el modelo "${rawName}" en tu schema.prisma`);
        process.exit(1);
    }

    const modelName = model.name;
    const modelLower = modelName.charAt(0).toLowerCase() + modelName.slice(1);
    const moduleDir = join(process.cwd(), "src", "modules", modelLower);

    if (existsSync(moduleDir)) {
        console.warn(`[WARNING] El módulo "${modelLower}" ya existe en src/modules/${modelLower}`);
        const shouldOverwrite = await askQuestion("¿Deseas sobreescribir los archivos existentes?");
        if (!shouldOverwrite) {
            console.log("[INFO] Operación cancelada.");
            process.exit(0);
        }
    } else {
        mkdirSync(moduleDir, { recursive: true });
    }

    const filesToGenerate = [
        {
            path: join(moduleDir, `${modelLower}.schema.ts`),
            content: generateSchema(modelName, model.fields),
            name: "Schema",
        },
        {
            path: join(moduleDir, `${modelLower}.controller.ts`),
            content: generateController(modelName),
            name: "Controller",
        },
        {
            path: join(moduleDir, `${modelLower}.service.ts`),
            content: generateService(modelName),
            name: "Service",
        },
        {
            path: join(moduleDir, `${modelLower}.routes.ts`),
            content: generateRoutes(modelName),
            name: "Routes",
        },
    ];

    console.log(`\n[INFO] Generando módulo para: ${modelName}...`);

    for (const file of filesToGenerate) {
        writeFileSync(file.path, file.content, "utf-8");
        console.log(`  ✅ [INFO] Archivo creado: src/modules/${modelLower}/${file.name.toLowerCase()}.ts`);
    }

    console.log(`\n✨ [INFO] ¡Módulo ${modelName} generado con éxito!\n`);
}