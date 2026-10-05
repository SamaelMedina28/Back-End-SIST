import { localDateRange } from "../dashboard/dashboard.time.js";
import type { ReportQuery } from "./report.schema.js";
import type { ActivityReport, ReportRepository } from "./report.types.js";

export class ReportService {
    constructor(private readonly repository: ReportRepository, private readonly timeZone: string) {}

    async activity(query: ReportQuery): Promise<ActivityReport> {
        const range = localDateRange(query.from, query.to, this.timeZone);
        const report = await this.repository.activity({ ...range, timeZone: this.timeZone,
            ...(query.supportArea ? { supportArea: query.supportArea } : {}),
            ...(query.categoryId ? { categoryId: query.categoryId } : {}),
            ...(query.technicianId ? { technicianId: query.technicianId } : {}),
        });
        const byDate = new Map(report.daily.map((row) => [row.date, row]));
        const cursor = new Date(`${query.from}T00:00:00.000Z`);
        const daily: ActivityReport["daily"] = [];
        while (cursor.toISOString().slice(0, 10) <= query.to) {
            const date = cursor.toISOString().slice(0, 10);
            daily.push(byDate.get(date) ?? { date, created: 0, completed: 0 });
            cursor.setUTCDate(cursor.getUTCDate() + 1);
        }
        return { ...report, daily };
    }
}
