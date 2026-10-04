import type { PrismaClient } from "../../../generated/prisma/client.js";
import {
    CatalogRepositoryConflict,
    CatalogRepositoryNotFound,
    type CatalogRepository,
    type CategoryRecord,
    type CreateCategoryInput,
    type CreateSubcategoryInput,
    type SubcategoryRecord,
    type SupportSuggestionRecord,
    type UpdateCategoryInput,
    type UpdateSubcategoryInput,
} from "./category.types.js";

const activeSubcategories = () => ({
    where: { isActive: true },
    orderBy: [{ name: "asc" as const }, { id: "asc" as const }],
});

function mapPrismaError(error: unknown): Error | null {
    if (!error || typeof error !== "object" || !("code" in error)) return null;

    if (error.code === "P2002") {
        const meta = "meta" in error && error.meta && typeof error.meta === "object"
            ? error.meta as { target?: unknown }
            : undefined;
        const target = Array.isArray(meta?.target)
            ? meta.target.join(",")
            : String(meta?.target ?? "");
        if (target.includes("categoryId") && target.includes("code")) {
            return new CatalogRepositoryConflict("subcategoryCode");
        }
        if (target.includes("code")) return new CatalogRepositoryConflict("categoryCode");
        return new CatalogRepositoryConflict("unknown");
    }

    if (error.code === "P2025") return new CatalogRepositoryNotFound();
    return null;
}

async function translate<T>(operation: () => Promise<T>): Promise<T> {
    try {
        return await operation();
    } catch (error) {
        throw mapPrismaError(error) ?? error;
    }
}

export class PrismaCatalogRepository implements CatalogRepository {
    constructor(private readonly prisma: PrismaClient) {}

    async listCategories(includeInactive: boolean): Promise<CategoryRecord[]> {
        const categories = await this.prisma.category.findMany({
            ...(!includeInactive ? { where: { isActive: true } } : {}),
            include: { subcategories: activeSubcategories() },
            orderBy: [{ name: "asc" }, { id: "asc" }],
        });
        return categories as CategoryRecord[];
    }

    async findCategoryById(id: string): Promise<CategoryRecord | null> {
        const category = await this.prisma.category.findUnique({
            where: { id },
            include: { subcategories: activeSubcategories() },
        });
        return category as CategoryRecord | null;
    }

    async findActiveCategoryById(id: string): Promise<CategoryRecord | null> {
        const category = await this.prisma.category.findFirst({
            where: { id, isActive: true },
            include: { subcategories: activeSubcategories() },
        });
        return category as CategoryRecord | null;
    }

    createCategory(input: CreateCategoryInput): Promise<CategoryRecord> {
        return translate(() => this.prisma.category.create({
            data: input,
            include: { subcategories: activeSubcategories() },
        }));
    }

    updateCategory(id: string, input: UpdateCategoryInput): Promise<CategoryRecord> {
        return translate(() => this.prisma.category.update({
            where: { id },
            data: {
                ...(input.name !== undefined ? { name: input.name } : {}),
                ...(input.supportArea !== undefined ? { supportArea: input.supportArea } : {}),
                ...(input.defaultPriority !== undefined ? { defaultPriority: input.defaultPriority } : {}),
                ...(input.requiresSoftwareDetails !== undefined
                    ? { requiresSoftwareDetails: input.requiresSoftwareDetails }
                    : {}),
                ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
            },
            include: { subcategories: activeSubcategories() },
        }));
    }

    async deactivateCategory(id: string): Promise<void> {
        await translate(() => this.prisma.category.updateMany({
            where: { id, isActive: true },
            data: { isActive: false },
        }).then(async (result) => {
            if (result.count === 0 && !await this.prisma.category.findUnique({ where: { id }, select: { id: true } })) {
                throw new CatalogRepositoryNotFound();
            }
        }));
    }

    findSubcategoryById(id: string): Promise<SubcategoryRecord | null> {
        return this.prisma.subcategory.findUnique({ where: { id } });
    }

    findSubcategoryByIdAndCategory(id: string, categoryId: string): Promise<SubcategoryRecord | null> {
        return this.prisma.subcategory.findFirst({ where: { id, categoryId } });
    }

    createSubcategory(input: CreateSubcategoryInput): Promise<SubcategoryRecord> {
        return translate(() => this.prisma.subcategory.create({
            data: {
                categoryId: input.categoryId,
                code: input.code,
                name: input.name,
                priority: input.priority,
            },
        }));
    }

    updateSubcategory(id: string, input: UpdateSubcategoryInput): Promise<SubcategoryRecord> {
        return translate(() => this.prisma.subcategory.update({
            where: { id },
            data: {
                ...(input.name !== undefined ? { name: input.name } : {}),
                ...(input.priority !== undefined ? { priority: input.priority } : {}),
                ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
            },
        }));
    }

    async deactivateSubcategory(id: string): Promise<void> {
        await translate(() => this.prisma.subcategory.updateMany({
            where: { id, isActive: true },
            data: { isActive: false },
        }).then(async (result) => {
            if (result.count === 0 && !await this.prisma.subcategory.findUnique({ where: { id }, select: { id: true } })) {
                throw new CatalogRepositoryNotFound();
            }
        }));
    }

    listActiveSupportSuggestions(
        categoryId: string,
        subcategoryId: string | undefined,
    ): Promise<SupportSuggestionRecord[]> {
        return this.prisma.supportSuggestion.findMany({
            where: {
                categoryId,
                isActive: true,
                ...(subcategoryId === undefined
                    ? { subcategoryId: null }
                    : { OR: [{ subcategoryId: null }, { subcategoryId }] }),
            },
            select: {
                id: true,
                categoryId: true,
                subcategoryId: true,
                title: true,
                description: true,
                isActive: true,
                createdAt: true,
                updatedAt: true,
            },
            orderBy: [{ title: "asc" }, { id: "asc" }],
        });
    }
}
