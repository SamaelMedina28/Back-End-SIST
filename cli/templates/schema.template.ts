// Definimos una interfaz simple con solo las propiedades que usamos del DMMF
interface PrismaField {
    name: string;
    type: string;
    isRequired: boolean;
    kind: string;
}

/**
 * Convierte los campos de un modelo de Prisma a tipos de Zod
 */
export function generateSchema(
    modelName: string,
    fields: readonly PrismaField[] | readonly any[],
): string {
    // Campos autogenerados que no se deben pedir al CREAR un registro
    const ignoredFields = ["id", "createdAt", "updatedAt"];

    const zodFields = fields
        // Descartamos campos autogenerados y relaciones de Prisma (kind === "object")
        .filter(
            (field) =>
                !ignoredFields.includes(field.name) && field.kind !== "object",
        )
        .map((field) => {
            let zodType = "z.string()";

            switch (field.type) {
                case "Int":
                    zodType = "z.number().int()";
                    break;
                case "Float":
                case "Decimal":
                    zodType = "z.number()";
                    break;
                case "Boolean":
                    zodType = "z.boolean()";
                    break;
                case "DateTime":
                    zodType = "z.coerce.date()";
                    break;
                case "String":
                default:
                    zodType = "z.string()";
                    break;
            }

            // Si el campo es opcional en Prisma (ej: String?)
            if (!field.isRequired) {
                zodType += ".optional()";
            }

            return `    ${field.name}: ${zodType},`;
        })
        .join("\n");

    return `import { z } from "zod";

/**
 * Esquema de validación para la creación de ${modelName}
 */
export const create${modelName}Schema = z.object({
${zodFields}
});

/**
 * Esquema de validación para actualización (todos los campos opcionales)
 */
export const update${modelName}Schema = create${modelName}Schema.partial();

// Tipos inferidos de TypeScript
export type Create${modelName}Input = z.infer<typeof create${modelName}Schema>;
export type Update${modelName}Input = z.infer<typeof update${modelName}Schema>;
`;
}
