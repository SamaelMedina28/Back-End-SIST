import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { openApiDocument } from "../src/openapi/openapi.js";

const functionalRoutes = [
    "GET /api/v1/auth/google", "GET /api/v1/auth/google/callback", "POST /api/v1/auth/complete-profile",
    "GET /api/v1/auth/me", "POST /api/v1/auth/logout", "PATCH /api/v1/users/me",
    "GET /api/v1/catalog/ticket-form", "GET /api/v1/catalog/support-suggestions",
    "GET /api/v1/categories", "POST /api/v1/categories", "PATCH /api/v1/categories/{id}",
    "DELETE /api/v1/categories/{id}", "POST /api/v1/categories/{categoryId}/subcategories",
    "PATCH /api/v1/subcategories/{id}", "DELETE /api/v1/subcategories/{id}",
    "POST /api/v1/tickets", "GET /api/v1/tickets", "GET /api/v1/tickets/{id}",
    "GET /api/v1/tickets/{id}/events", "POST /api/v1/tickets/{id}/assign-self",
    "PUT /api/v1/tickets/{id}/assignee", "DELETE /api/v1/tickets/{id}/assignee",
    "PATCH /api/v1/tickets/{id}/status", "PATCH /api/v1/tickets/{id}/priority",
    "GET /api/v1/activity-log", "POST /api/v1/activity-log", "GET /api/v1/activity-log/{id}",
    "PATCH /api/v1/activity-log/{id}", "GET /api/v1/activity-log/{id}/history",
    "GET /api/v1/inventory", "POST /api/v1/inventory", "GET /api/v1/inventory/{id}",
    "PATCH /api/v1/inventory/{id}", "DELETE /api/v1/inventory/{id}",
    "GET /api/v1/inventory/{id}/tickets", "GET /api/v1/support-members",
    "POST /api/v1/support-members", "GET /api/v1/support-members/{id}",
    "PATCH /api/v1/support-members/{id}", "DELETE /api/v1/support-members/{id}",
    "GET /api/v1/dashboard", "GET /api/v1/reports/activity",
];

const documentedRoutes = readFileSync(new URL("../docs/API.md", import.meta.url), "utf8")
    .matchAll(/^### `(GET|POST|PUT|PATCH|DELETE) (\/[^`]+)`$/gmu);
const apiGuideRoutes = [...documentedRoutes]
    .map((match) => `${match[1]} ${match[2]?.replace(/:([A-Za-z]+)/gu, "{$1}")}`)
    .filter((route) => route.includes(" /api/v1/"));

function openApiRoutes(): string[] {
    const result: string[] = [];
    const methods = new Set(["get", "post", "put", "patch", "delete"]);
    for (const [path, operations] of Object.entries(openApiDocument.paths)) {
        for (const method of Object.keys(operations)) {
            if (methods.has(method)) result.push(`${method.toUpperCase()} ${path}`);
        }
    }
    return result;
}

describe("documented route inventory", () => {
    it("keeps the known functional routes aligned with OpenAPI and API.md", () => {
        expect([...apiGuideRoutes].sort()).toEqual([...functionalRoutes].sort());
        const expectedOpenApi = [...functionalRoutes, "GET /health", "GET /ready"].sort();
        expect(openApiRoutes().sort()).toEqual(expectedOpenApi);
        const apiGuide = readFileSync(new URL("../docs/API.md", import.meta.url), "utf8");
        expect(apiGuide).toContain("GET /api/docs");
        expect(apiGuide).toContain("GET /api/openapi.json");
    });

    it("does not expose retired starter/demo API paths", () => {
        const paths = Object.keys(openApiDocument.paths);
        expect(paths.some((path) => /\/api\/(auth|products?|libros?|uber)(\/|$)/iu.test(path))).toBe(false);
    });
});
