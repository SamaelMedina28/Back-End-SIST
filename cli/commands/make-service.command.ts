import { join } from "path";
import { parsePathAndName } from "../utils/path.util.js";
import { writeGeneratedFile } from "../utils/file-writer.util.js";
import { generateService } from "../templates/service.template.js";

export async function handleMakeService(rawName: string, isModuleFlag: boolean): Promise<void> {
    const { targetDir, nameUpper, nameLower, relativePath } = parsePathAndName(
        rawName,
        "services",
        isModuleFlag
    );

    const filePath = join(targetDir, `${nameLower}.service.ts`);
    const displayPath = `src/${relativePath}.service.ts`;

    await writeGeneratedFile(
        targetDir,
        filePath,
        generateService(nameUpper),
        displayPath
    );
}