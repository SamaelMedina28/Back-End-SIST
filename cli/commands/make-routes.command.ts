import { join } from "path";
import { parsePathAndName } from "../utils/path.util.js";
import { writeGeneratedFile } from "../utils/file-writer.util.js";
import { generateRoutes } from "../templates/routes.template.js";

export async function handleMakeRoutes(rawName: string, isModuleFlag: boolean): Promise<void> {
    const { targetDir, nameUpper, nameLower, relativePath } = parsePathAndName(
        rawName,
        "routes",
        isModuleFlag
    );

    const filePath = join(targetDir, `${nameLower}.routes.ts`);
    const displayPath = `src/${relativePath}.routes.ts`;

    await writeGeneratedFile(
        targetDir,
        filePath,
        generateRoutes(nameUpper),
        displayPath
    );
}