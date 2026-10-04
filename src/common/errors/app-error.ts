export type ErrorFields = Record<string, string[]>;

export class AppError extends Error {
    constructor(
        public readonly statusCode: number,
        public readonly code: string,
        message: string,
        public readonly fields?: ErrorFields,
    ) {
        super(message);
        this.name = "AppError";
    }
}

