import { AppError } from "../../common/errors/app-error.js";
import type { CatalogRepository } from "../category/category.types.js";
import { MAX_ACTIVE_TICKETS } from "../category/category.service.js";

export class CatalogService {
    constructor(private readonly catalog: CatalogRepository) {}

    async getTicketForm() {
        const categories = await this.catalog.listCategories(false);
        return {
            categories: categories.map((category) => ({
                id: category.id,
                code: category.code,
                name: category.name,
                supportArea: category.supportArea,
                defaultPriority: category.defaultPriority,
                requiresSoftwareDetails: category.requiresSoftwareDetails,
                subcategories: category.subcategories
                    .filter((subcategory) => subcategory.isActive)
                    .map((subcategory) => ({
                        id: subcategory.id,
                        code: subcategory.code,
                        name: subcategory.name,
                        priority: subcategory.priority,
                    })),
            })),
            maxActiveTickets: MAX_ACTIVE_TICKETS,
        };
    }

    async getSupportSuggestions(categoryId: string, subcategoryId?: string) {
        const category = await this.catalog.findActiveCategoryById(categoryId);
        if (!category) throw new AppError(404, "CATEGORY_NOT_FOUND", "La categoría no existe o está inactiva.");

        if (subcategoryId) {
            const subcategory = await this.catalog.findSubcategoryByIdAndCategory(subcategoryId, categoryId);
            if (!subcategory) {
                throw new AppError(404, "SUBCATEGORY_NOT_FOUND", "La subcategoría no pertenece a esta categoría.");
            }
        }

        const suggestions = await this.catalog.listActiveSupportSuggestions(categoryId, subcategoryId);
        return suggestions.map(({ id, title, description }) => ({ id, title, description }));
    }
}
