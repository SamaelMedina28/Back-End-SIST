import { describe, expect, it } from "vitest";
import { localDateRange } from "../src/modules/dashboard/dashboard.time.js";
import { reportQuerySchema } from "../src/modules/report/report.schema.js";
import { ReportService } from "../src/modules/report/report.service.js";
import type { ReportRepository } from "../src/modules/report/report.types.js";

describe("Reports API: fechas y serie diaria", () => {
    it("rechaza fechas imposibles, ambiguas y rangos invertidos", () => {
        for (const query of [
            { from: "2026-02-31", to: "2026-03-01" },
            { from: "01/09/2026", to: "2026-09-30" },
            { from: "2026-10-05", to: "2026-10-04" },
            { from: "2026-09-01", to: "2026-09-30", supportArea: "WRONG" },
        ]) expect(reportQuerySchema.safeParse(query).success).toBe(false);
        expect(reportQuerySchema.safeParse({ from: "2028-02-29", to: "2028-03-01" }).success).toBe(true);
    });

    it("usa los límites locales exactos en los cambios de horario", () => {
        const spring = localDateRange("2026-03-08", "2026-03-08", "America/Tijuana");
        expect(spring.start.toISOString()).toBe("2026-03-08T08:00:00.000Z");
        expect(spring.end.toISOString()).toBe("2026-03-09T07:00:00.000Z");
        const fall = localDateRange("2026-11-01", "2026-11-01", "America/Tijuana");
        expect(fall.start.toISOString()).toBe("2026-11-01T07:00:00.000Z");
        expect(fall.end.toISOString()).toBe("2026-11-02T08:00:00.000Z");
    });

    it("rellena días sin actividad sin consultar tickets individuales", async () => {
        const repository: ReportRepository = { activity: async () => ({
            summary: { ticketsCreated: 1, ticketsCompleted: 0, pending: 1, averageResolutionMinutes: 0 },
            byCategory: [], byTechnician: [], daily: [{ date: "2026-10-04", created: 1, completed: 0 }],
        }) };
        const result = await new ReportService(repository, "America/Tijuana").activity({
            from: "2026-10-04", to: "2026-10-06",
        });
        expect(result.daily).toEqual([
            { date: "2026-10-04", created: 1, completed: 0 },
            { date: "2026-10-05", created: 0, completed: 0 },
            { date: "2026-10-06", created: 0, completed: 0 },
        ]);
    });
});
