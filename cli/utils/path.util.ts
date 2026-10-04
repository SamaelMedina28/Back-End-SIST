import { join, dirname, basename } from "node:path";

/**
 * Procesa la notación por puntos y banderas como -m
 */
export function parsePathAndName(
    rawInput: string,
    defaultFolder: string,
    isModuleFlag: boolean,
) {
    // Reemplaza puntos por barras: "libro.libro" -> "libro/libro"
    const normalizedPath = rawInput.replace(/\./g, "/");

    // Extrae el nombre final del archivo: "libro"
    const rawFileName = basename(normalizedPath);

    // Extrae las subcarpetas: "libro"
    const subDirs = dirname(normalizedPath);

    // Formateamos las variaciones de nombre
    const nameUpper =
        rawFileName.charAt(0).toUpperCase() + rawFileName.slice(1);
    const nameLower =
        rawFileName.charAt(0).toLowerCase() + rawFileName.slice(1);

    // Si pasaron la bandera -m, la carpeta base cambia de "controllers" a "modules"
    const baseFolder = isModuleFlag ? "modules" : defaultFolder;

    // Construye la ruta final
    const targetDir =
        subDirs !== "."
            ? join(process.cwd(), "src", baseFolder, subDirs)
            : join(process.cwd(), "src", baseFolder);

    const relativePath =
        subDirs !== "."
            ? `${baseFolder}/${subDirs}/${nameLower}`
            : `${baseFolder}/${nameLower}`;

    return {
        targetDir,
        nameUpper,
        nameLower,
        relativePath,
    };
}