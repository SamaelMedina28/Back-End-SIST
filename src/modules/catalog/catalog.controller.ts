import type { Request, Response } from "express";
import { sendSuccess } from "../../common/http/response.js";
import type { SupportSuggestionsQuery } from "./catalog.schema.js";
import { CatalogService } from "./catalog.service.js";

export class CatalogController {
    constructor(private readonly catalog: CatalogService) {}

    ticketForm = async (_req: Request, res: Response): Promise<void> => {
        sendSuccess(res, await this.catalog.getTicketForm());
    };

    supportSuggestions = async (req: Request, res: Response): Promise<void> => {
        const query = req.query as unknown as SupportSuggestionsQuery;
        const suggestions = await this.catalog.getSupportSuggestions(query.categoryId, query.subcategoryId);
        sendSuccess(res, suggestions);
    };
}
