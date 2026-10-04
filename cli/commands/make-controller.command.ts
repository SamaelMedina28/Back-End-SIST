import { join } from "path";
import { parsePathAndName } from "../utils/path.util.js";
import { writeGeneratedFile } from "../utils/file-writer.util.js";
import { generateController } from "../templates/controller.template.js";

export async function handleMakeController(rawName: string, isModuleFlag: boolean): Promise<void> {
    const { targetDir, nameUpper, nameLower, relativePath } = parsePathAndName(
        rawName,
        "controllers",
        isModuleFlag
    );

    const filePath = join(targetDir, `${nameLower}.controller.ts`);
    const displayPath = `src/${relativePath}.controller.ts`;

    await writeGeneratedFile(
        targetDir,
        filePath,
        generateController(nameUpper),
        displayPath
    );
}