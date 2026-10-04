import type { SupportArea, TicketPriority } from "../../../generated/prisma/client.js";

export interface SubcategoryRecord {
    id: string;
    categoryId: string;
    code: string;
    name: string;
    priority: TicketPriority | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface CategoryRecord {
    id: string;
    code: string;
    name: string;
    supportArea: SupportArea;
    defaultPriority: TicketPriority | null;
    isActive: boolean;
    requiresSoftwareDetails: boolean;
    createdAt: Date;
    updatedAt: Date;
    subcategories: SubcategoryRecord[];
}

export interface SupportSuggestionRecord {
    id: string;
    categoryId: string;
    subcategoryId: string | null;
    title: string;
    description: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateCategoryInput {
    code: string;
    name: string;
    supportArea: SupportArea;
    defaultPriority: TicketPriority | null;
    requiresSoftwareDetails: boolean;
}

export interface UpdateCategoryInput {
    name?: string;
    supportArea?: SupportArea;
    defaultPriority?: TicketPriority | null;
    requiresSoftwareDetails?: boolean;
    isActive?: boolean;
}

export interface CreateSubcategoryInput {
    categoryId: string;
    code: string;
    name: string;
    priority: TicketPriority | null;
}

export interface UpdateSubcategoryInput {
    name?: string;
    priority?: TicketPriority | null;
    isActive?: boolean;
}

export interface CatalogRepository {
    listCategories(includeInactive: boolean): Promise<CategoryRecord[]>;
    findCategoryById(id: string): Promise<CategoryRecord | null>;
    findActiveCategoryById(id: string): Promise<CategoryRecord | null>;
    createCategory(input: CreateCategoryInput): Promise<CategoryRecord>;
    updateCategory(id: string, input: UpdateCategoryInput): Promise<CategoryRecord>;
    deactivateCategory(id: string): Promise<void>;
    findSubcategoryById(id: string): Promise<SubcategoryRecord | null>;
    findSubcategoryByIdAndCategory(id: string, categoryId: string): Promise<SubcategoryRecord | null>;
    createSubcategory(input: CreateSubcategoryInput): Promise<SubcategoryRecord>;
    updateSubcategory(id: string, input: UpdateSubcategoryInput): Promise<SubcategoryRecord>;
    deactivateSubcategory(id: string): Promise<void>;
    listActiveSupportSuggestions(
        categoryId: string,
        subcategoryId: string | undefined,
    ): Promise<SupportSuggestionRecord[]>;
}

export type RepositoryConflict = "categoryCode" | "subcategoryCode" | "unknown";

export class CatalogRepositoryConflict extends Error {
    constructor(public readonly conflict: RepositoryConflict) {
        super("Catalog unique constraint conflict");
        this.name = "CatalogRepositoryConflict";
    }
}

export class CatalogRepositoryNotFound extends Error {
    constructor() {
        super("Catalog record not found");
        this.name = "CatalogRepositoryNotFound";
    }
}
