import type { Request, Response } from "express";
import { sendSuccess } from "../../common/http/response.js";
import type {
    CreateCategoryBody,
    CreateSubcategoryBody,
    UpdateCategoryBody,
    UpdateSubcategoryBody,
} from "./category.schema.js";
import type { UpdateCategoryInput, UpdateSubcategoryInput } from "./category.types.js";
import { CategoryService } from "./category.service.js";

function toCategoryResponse(category: Awaited<ReturnType<CategoryService["listCategories"]>>[number]) {
    return {
        id: category.id,
        code: category.code,
        name: category.name,
        supportArea: category.supportArea,
        defaultPriority: category.defaultPriority,
        requiresSoftwareDetails: category.requiresSoftwareDetails,
        isActive: category.isActive,
        subcategories: category.subcategories.map((subcategory) => ({
            id: subcategory.id,
            code: subcategory.code,
            name: subcategory.name,
            priority: subcategory.priority,
            isActive: subcategory.isActive,
        })),
    };
}

export class CategoryController {
    constructor(private readonly categories: CategoryService) {}

    list = async (req: Request, res: Response): Promise<void> => {
        const query = req.query as { includeInactive?: boolean };
        const categories = await this.categories.listCategories(query.includeInactive === true);
        sendSuccess(res, categories.map(toCategoryResponse));
    };

    create = async (req: Request, res: Response): Promise<void> => {
        const category = await this.categories.createCategory(req.body as CreateCategoryBody);
        sendSuccess(res, toCategoryResponse(category), 201);
    };

    update = async (req: Request, res: Response): Promise<void> => {
        const body = req.body as UpdateCategoryBody;
        const input: UpdateCategoryInput = {};
        if (body.name !== undefined) input.name = body.name;
        if (body.supportArea !== undefined) input.supportArea = body.supportArea;
        if (body.defaultPriority !== undefined) input.defaultPriority = body.defaultPriority;
        if (body.requiresSoftwareDetails !== undefined) input.requiresSoftwareDetails = body.requiresSoftwareDetails;
        if (body.isActive !== undefined) input.isActive = body.isActive;
        const category = await this.categories.updateCategory(
            req.params.id as string,
            input,
        );
        sendSuccess(res, toCategoryResponse(category));
    };

    deactivate = async (req: Request, res: Response): Promise<void> => {
        await this.categories.deactivateCategory(req.params.id as string);
        res.status(204).send();
    };

    createSubcategory = async (req: Request, res: Response): Promise<void> => {
        const body = req.body as CreateSubcategoryBody;
        const subcategory = await this.categories.createSubcategory({
            ...body,
            categoryId: req.params.categoryId as string,
        });
        sendSuccess(res, {
            id: subcategory.id,
            categoryId: subcategory.categoryId,
            code: subcategory.code,
            name: subcategory.name,
            priority: subcategory.priority,
            isActive: subcategory.isActive,
        }, 201);
    };

    updateSubcategory = async (req: Request, res: Response): Promise<void> => {
        const body = req.body as UpdateSubcategoryBody;
        const input: UpdateSubcategoryInput = {};
        if (body.name !== undefined) input.name = body.name;
        if (body.priority !== undefined) input.priority = body.priority;
        if (body.isActive !== undefined) input.isActive = body.isActive;
        const subcategory = await this.categories.updateSubcategory(
            req.params.id as string,
            input,
        );
        sendSuccess(res, {
            id: subcategory.id,
            categoryId: subcategory.categoryId,
            code: subcategory.code,
            name: subcategory.name,
            priority: subcategory.priority,
            isActive: subcategory.isActive,
        });
    };

    deactivateSubcategory = async (req: Request, res: Response): Promise<void> => {
        await this.categories.deactivateSubcategory(req.params.id as string);
        res.status(204).send();
    };
}
