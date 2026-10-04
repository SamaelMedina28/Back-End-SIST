import { AppError } from "../../common/errors/app-error.js";
import type { TicketPriority } from "../../../generated/prisma/client.js";
import {
    CatalogRepositoryConflict,
    CatalogRepositoryNotFound,
    type CatalogRepository,
    type CategoryRecord,
    type CreateCategoryInput,
    type CreateSubcategoryInput,
    type SubcategoryRecord,
    type UpdateCategoryInput,
    type UpdateSubcategoryInput,
} from "./category.types.js";

export const MAX_ACTIVE_TICKETS = 10;

export function resolveEffectivePriority(
    subcategoryPriority: TicketPriority | null | undefined,
    categoryDefaultPriority: TicketPriority | null,
): TicketPriority | null {
    return subcategoryPriority ?? categoryDefaultPriority;
}

export class CategoryService {
    constructor(private readonly catalog: CatalogRepository) {}

    listCategories(includeInactive = false): Promise<CategoryRecord[]> {
        return this.catalog.listCategories(includeInactive);
    }

    async createCategory(input: CreateCategoryInput): Promise<CategoryRecord> {
        try {
            return await this.catalog.createCategory(input);
        } catch (error) {
            if (error instanceof CatalogRepositoryConflict && error.conflict === "categoryCode") {
                throw new AppError(409, "CATEGORY_CODE_ALREADY_EXISTS", "El código de categoría ya existe.");
            }
            throw error;
        }
    }

    async updateCategory(id: string, input: UpdateCategoryInput): Promise<CategoryRecord> {
        try {
            return await this.catalog.updateCategory(id, input);
        } catch (error) {
            if (error instanceof CatalogRepositoryNotFound) {
                throw new AppError(404, "CATEGORY_NOT_FOUND", "La categoría no existe.");
            }
            throw error;
        }
    }

    async deactivateCategory(id: string): Promise<void> {
        try {
            await this.catalog.deactivateCategory(id);
        } catch (error) {
            if (error instanceof CatalogRepositoryNotFound) {
                throw new AppError(404, "CATEGORY_NOT_FOUND", "La categoría no existe.");
            }
            throw error;
        }
    }

    async createSubcategory(input: CreateSubcategoryInput): Promise<SubcategoryRecord> {
        const category = await this.catalog.findCategoryById(input.categoryId);
        if (!category) throw new AppError(404, "CATEGORY_NOT_FOUND", "La categoría no existe.");
        if (!category.isActive) {
            throw new AppError(409, "CATEGORY_INACTIVE", "No se pueden agregar subcategorías a una categoría inactiva.");
        }

        try {
            return await this.catalog.createSubcategory(input);
        } catch (error) {
            if (error instanceof CatalogRepositoryConflict && error.conflict === "subcategoryCode") {
                throw new AppError(409, "SUBCATEGORY_CODE_ALREADY_EXISTS", "El código ya existe dentro de esta categoría.");
            }
            if (error instanceof CatalogRepositoryNotFound) {
                throw new AppError(404, "CATEGORY_NOT_FOUND", "La categoría no existe.");
            }
            throw error;
        }
    }

    async updateSubcategory(id: string, input: UpdateSubcategoryInput): Promise<SubcategoryRecord> {
        try {
            return await this.catalog.updateSubcategory(id, input);
        } catch (error) {
            if (error instanceof CatalogRepositoryNotFound) {
                throw new AppError(404, "SUBCATEGORY_NOT_FOUND", "La subcategoría no existe.");
            }
            throw error;
        }
    }

    async deactivateSubcategory(id: string): Promise<void> {
        try {
            await this.catalog.deactivateSubcategory(id);
        } catch (error) {
            if (error instanceof CatalogRepositoryNotFound) {
                throw new AppError(404, "SUBCATEGORY_NOT_FOUND", "La subcategoría no existe.");
            }
            throw error;
        }
    }
}
