import { existsSync, mkdirSync, writeFileSync } from "fs";
import { askQuestion } from "./prompt.util.js";

export async function writeGeneratedFile(
    targetDir: string,
    filePath: string,
    fileContent: string,
    displayPath: string
): Promise<boolean> {
    if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
    }

    if (existsSync(filePath)) {
        console.warn(`[WARNING] El archivo "${displayPath}" ya existe.`);
        const shouldOverwrite = await askQuestion("¿Deseas sobreescribirlo?");
        if (!shouldOverwrite) {
            console.log("[INFO] Operación cancelada.");
            return false;
        }
    }

    writeFileSync(filePath, fileContent, "utf-8");
    console.log(`\n✅ [INFO] Archivo creado en: ${displayPath}\n`);
    return true;
}