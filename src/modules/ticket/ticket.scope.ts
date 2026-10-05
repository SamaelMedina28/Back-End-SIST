import type { SupportArea } from "../../../generated/prisma/client.js";

export function supportAreaTicketFilter(areas: readonly SupportArea[]) {
    return { category: { supportArea: { in: [...areas] } } };
}
