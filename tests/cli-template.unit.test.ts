import { describe, expect, it } from "vitest";
import { generateSchema } from "../cli/templates/schema.template.js";
import { generateService } from "../cli/templates/service.template.js";

describe("starter CLI templates", () => {
    it("derives service identifiers and inputs from generated Prisma delegate types", () => {
        const output = generateService("User");
        expect(output).toContain('Parameters<typeof prisma.user.findUnique>[0]["where"]["id"]');
        expect(output).toContain('Parameters<typeof prisma.user.create>[0]["data"]');
        expect(output).not.toContain(": any");
    });

    it("accepts the structural DMMF fields used by make-all without an any escape hatch", () => {
        const output = generateSchema("Example", [{ name: "title", type: "String", kind: "scalar", isRequired: true }]);
        expect(output).toContain("title: z.string(),");
    });
});
