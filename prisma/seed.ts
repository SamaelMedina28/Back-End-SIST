import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import {
    PrismaClient,
    SupportArea,
    TicketPriority,
} from "../generated/prisma/client.js";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    throw new Error("DATABASE_URL es obligatorio para ejecutar el seed.");
}

const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
});

type CategorySeed = {
    code: string;
    name: string;
    supportArea: SupportArea;
    defaultPriority: TicketPriority | null;
    requiresSoftwareDetails?: boolean;
    subcategories?: Array<{
        code: string;
        name: string;
        priority: TicketPriority | null;
    }>;
};

const categories: CategorySeed[] = [
    {
        code: "EQUIPMENT_FAILURE",
        name: "Falla de equipo",
        supportArea: SupportArea.HARDWARE,
        defaultPriority: null,
        subcategories: [
            { code: "DATE_TIME_RESET", name: "Reinicio de fecha y hora", priority: TicketPriority.MEDIUM },
            { code: "SYSTEM_INOPERABLE", name: "Sistema inoperable", priority: TicketPriority.HIGH },
            { code: "BOOT_LOOP", name: "Arranque perpetuo", priority: TicketPriority.HIGH },
            { code: "NETWORK_CONNECTIVITY", name: "Falla de conectividad a la red", priority: TicketPriority.MEDIUM },
            { code: "MISSING_PERIPHERALS", name: "Falta de periféricos para su operación", priority: TicketPriority.LOW },
            { code: "OTHER", name: "Otros", priority: null },
        ],
    },
    {
        code: "MONITOR_FAILURE",
        name: "Falla de monitor",
        supportArea: SupportArea.HARDWARE,
        defaultPriority: null,
        subcategories: [
            { code: "TOTAL_FAILURE", name: "Falla total", priority: TicketPriority.MEDIUM },
            { code: "PARTIAL_FAILURE", name: "Falla parcial", priority: TicketPriority.LOW },
        ],
    },
    {
        code: "PROJECTOR_FAILURE",
        name: "Falla de proyector",
        supportArea: SupportArea.HARDWARE,
        defaultPriority: null,
        subcategories: [
            { code: "OVERHEATING", name: "Apagado por sobrecalentamiento", priority: TicketPriority.HIGH },
            { code: "CONNECTION_FAILURE", name: "Falla de conexión", priority: TicketPriority.HIGH },
            { code: "BLURRY_IMAGE", name: "Imagen borrosa o con tinte", priority: TicketPriority.LOW },
            { code: "TOTAL_FAILURE", name: "Falla total", priority: TicketPriority.HIGH },
        ],
    },
    {
        code: "SOFTWARE_INSTALLATION",
        name: "Instalación de software",
        supportArea: SupportArea.SOFTWARE,
        defaultPriority: TicketPriority.HIGH,
        requiresSoftwareDetails: true,
    },
    {
        code: "PRINTER_INSTALLATION",
        name: "Instalación de impresora",
        supportArea: SupportArea.HARDWARE,
        defaultPriority: TicketPriority.HIGH,
    },
    {
        code: "PRINTER_FAILURE",
        name: "Falla de impresora",
        supportArea: SupportArea.HARDWARE,
        defaultPriority: null,
        subcategories: [
            { code: "CANNOT_PRINT", name: "Incapacidad de impresión", priority: TicketPriority.HIGH },
            { code: "OTHER", name: "Otros", priority: null },
        ],
    },
    {
        code: "ELECTRICAL_CABLING_FAILURE",
        name: "Falla de extensión o cableado eléctrico",
        supportArea: SupportArea.HARDWARE,
        defaultPriority: null,
    },
    {
        code: "PREVENTIVE_MAINTENANCE",
        name: "Mantenimiento preventivo a las máquinas",
        supportArea: SupportArea.HARDWARE,
        defaultPriority: TicketPriority.LOW,
    },
    {
        code: "EXAM_PREPARATION",
        name: "Preparación para exámenes colegiados",
        supportArea: SupportArea.ADMINISTRATIVE,
        defaultPriority: TicketPriority.HIGH,
    },
    {
        code: "OTHER",
        name: "Otros",
        supportArea: SupportArea.ADMINISTRATIVE,
        defaultPriority: null,
    },
];

async function main(): Promise<void> {
    for (const categorySeed of categories) {
        const category = await prisma.category.upsert({
            where: { code: categorySeed.code },
            update: {
                name: categorySeed.name,
                supportArea: categorySeed.supportArea,
                defaultPriority: categorySeed.defaultPriority,
                requiresSoftwareDetails: categorySeed.requiresSoftwareDetails ?? false,
                isActive: true,
            },
            create: {
                code: categorySeed.code,
                name: categorySeed.name,
                supportArea: categorySeed.supportArea,
                defaultPriority: categorySeed.defaultPriority,
                requiresSoftwareDetails: categorySeed.requiresSoftwareDetails ?? false,
            },
        });

        for (const subcategorySeed of categorySeed.subcategories ?? []) {
            await prisma.subcategory.upsert({
                where: {
                    categoryId_code: {
                        categoryId: category.id,
                        code: subcategorySeed.code,
                    },
                },
                update: {
                    name: subcategorySeed.name,
                    priority: subcategorySeed.priority,
                    isActive: true,
                },
                create: {
                    categoryId: category.id,
                    code: subcategorySeed.code,
                    name: subcategorySeed.name,
                    priority: subcategorySeed.priority,
                },
            });
        }
    }
}

main()
    .then(async () => {
        await prisma.$disconnect();
    })
    .catch(async (error: unknown) => {
        console.error(error);
        await prisma.$disconnect();
        process.exitCode = 1;
    });
