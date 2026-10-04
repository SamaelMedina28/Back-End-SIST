import { join } from "path";
import { writeGeneratedFile } from "../utils/file-writer.util.js";
import { generateMiddleware } from "../templates/middleware.template.js";

export async function handleMakeMiddleware(rawName: string): Promise<void> {
    const nameLower = rawName.charAt(0).toLowerCase() + rawName.slice(1);
    const targetDir = join(process.cwd(), "src", "middlewares");
    const filePath = join(targetDir, `${nameLower}.middleware.ts`);
    const displayPath = `src/middlewares/${nameLower}.middleware.ts`;

    await writeGeneratedFile(
        targetDir,
        filePath,
        generateMiddleware(rawName),
        displayPath
    );
}