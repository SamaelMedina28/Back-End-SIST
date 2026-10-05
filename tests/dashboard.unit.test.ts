import { describe, expect, it, vi } from "vitest";
import { Role, SupportArea } from "../generated/prisma/client.js";
import { loadConfig } from "../src/config/env.js";
import { DashboardService, orderTechnicianWorkload } from "../src/modules/dashboard/dashboard.service.js";
import { todayRange } from "../src/modules/dashboard/dashboard.time.js";
import type { DashboardRepository, TechnicianWorkloadItem } from "../src/modules/dashboard/dashboard.types.js";
import { makeUser } from "./helpers/fakes.js";

describe("zona horaria del dashboard", () => {
    it("usa el día local de Tijuana aunque UTC ya esté en el día siguiente", () => {
        const range = todayRange(new Date("2026-10-05T06:30:00.000Z"), "America/Tijuana");
        expect(range.start.toISOString()).toBe("2026-10-04T07:00:00.000Z");
        expect(range.end.toISOString()).toBe("2026-10-05T07:00:00.000Z");
    });

    it("respeta el salto estacional de primavera (23 horas)", () => {
        const range = todayRange(new Date("2026-03-08T20:00:00.000Z"), "America/Tijuana");
        expect(range.start.toISOString()).toBe("2026-03-08T08:00:00.000Z");
        expect(range.end.toISOString()).toBe("2026-03-09T07:00:00.000Z");
    });

    it("respeta el salto estacional de otoño (25 horas)", () => {
        const range = todayRange(new Date("2026-11-01T20:00:00.000Z"), "America/Tijuana");
        expect(range.start.toISOString()).toBe("2026-11-01T07:00:00.000Z");
        expect(range.end.toISOString()).toBe("2026-11-02T08:00:00.000Z");
    });

    it("valida APP_TIMEZONE al cargar configuración", () => {
        const source = {
            DATABASE_URL: "postgresql://user:pass@localhost:5432/support_system_test",
            FRONTEND_URL: "http://localhost:3001", JWT_SECRET: "a".repeat(32), SESSION_COOKIE_NAME: "sist_session",
            GOOGLE_CLIENT_ID: "client", GOOGLE_CLIENT_SECRET: "secret",
            GOOGLE_REDIRECT_URI: "http://localhost:3000/api/v1/auth/google/callback",
            ALLOWED_EMAIL_DOMAINS: "uabc.edu.mx", APP_TIMEZONE: "America/Tijuana",
        };
        expect(loadConfig(source).appTimezone).toBe("America/Tijuana");
        expect(() => loadConfig({ ...source, APP_TIMEZONE: "Not/A_Zone" })).toThrow();
    });
});

describe("despacho y orden del dashboard", () => {
    const fixedNow = () => new Date("2026-10-05T06:30:00.000Z");
    const userDashboard = vi.fn(async () => ({ stats: { active: 1, inProgress: 0, completed: 2 }, recentTickets: [] }));
    const supportDashboard = vi.fn(async () => ({ stats: { unassigned: 1, mine: 2, highPriority: 3, completedToday: 4 }, priorityTickets: [] }));
    const adminDashboard = vi.fn(async () => ({ stats: { activeTickets: 1, unassigned: 2, activeTechnicians: 3, inventoryItems: 4 }, technicianWorkload: [] }));
    const repository: DashboardRepository = { userDashboard, supportDashboard, adminDashboard };

    it.each([Role.USER, Role.SUPPORT, Role.SUB_MANAGER, Role.ADMIN])("consulta solo el agregado correspondiente a %s", async (role) => {
        userDashboard.mockClear(); supportDashboard.mockClear(); adminDashboard.mockClear();
        const service = new DashboardService(repository, "America/Tijuana", fixedNow);
        const user = makeUser({ role, supportAreas: [SupportArea.HARDWARE] });
        const result = await service.get(user);
        if (role === Role.USER) {
            expect(userDashboard).toHaveBeenCalledExactlyOnceWith(user.id);
            expect(supportDashboard).not.toHaveBeenCalled();
            expect(adminDashboard).not.toHaveBeenCalled();
            expect(result).toHaveProperty("recentTickets", []);
        } else if (role === Role.ADMIN) {
            expect(adminDashboard).toHaveBeenCalledTimes(1);
            expect(userDashboard).not.toHaveBeenCalled();
            expect(supportDashboard).not.toHaveBeenCalled();
            expect(result).toHaveProperty("technicianWorkload", []);
        } else {
            expect(supportDashboard).toHaveBeenCalledTimes(1);
            expect(supportDashboard.mock.calls[0]?.[0]).toBe(user.id);
            expect(supportDashboard.mock.calls[0]?.[1]).toEqual([SupportArea.HARDWARE]);
            expect(userDashboard).not.toHaveBeenCalled();
            expect(adminDashboard).not.toHaveBeenCalled();
            expect(result).toHaveProperty("priorityTickets", []);
        }
    });

    it("no tiene fallback que otorgue dashboard ADMIN a un rol desconocido", async () => {
        const service = new DashboardService(repository, "America/Tijuana", fixedNow);
        await expect(service.get(makeUser({ role: "UNKNOWN" as Role }))).rejects.toThrow("Unknown authenticated role");
    });

    it("ordena la carga por tickets descendente, nombre e id", () => {
        const item = (userId: string, name: string, activeTickets: number): TechnicianWorkloadItem => ({
            userId, name, supportAreas: [], activeTickets, completedToday: 0,
        });
        const ordered = orderTechnicianWorkload([
            item("b", "Zoe", 2), item("c", "Ana", 2), item("a", "Ana", 2), item("d", "Luis", 3),
        ]);
        expect(ordered.map((entry) => entry.userId)).toEqual(["d", "a", "c", "b"]);
    });
});
