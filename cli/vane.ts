#!/usr/bin/env node
import { printBanner, printHelp, logger } from "./utils/logger.util.js";

async function main() {
    const args = process.argv.slice(2);
    const isModuleFlag = args.includes("-m") || args.includes("--module");
    const cleanArgs = args.filter((arg) => !arg.startsWith("-"));

    const firstArg = cleanArgs[0];
    const secondArg = cleanArgs[1];

    if (!firstArg || firstArg === "--help" || firstArg === "-h") {
        printHelp();
        process.exit(0);
    }

    const isSubcommand = firstArg.startsWith("make:");
    const command = isSubcommand ? firstArg : "make:all";
    const rawName = isSubcommand ? secondArg : firstArg;

    if (!rawName) {
        printBanner();
        logger.error(`Debes indicar el nombre objetivo para el comando "${command}".`);
        console.log(`   Ejemplo: pnpm vane ${command} MiModelo\n`);
        process.exit(1);
    }

    printBanner();

    switch (command) {
        case "make:all": {
            const { handleMakeAll } = await import("./commands/make-all.command.js");
            await handleMakeAll(rawName);
            break;
        }
        case "make:middleware": {
            const { handleMakeMiddleware } = await import("./commands/make-middleware.command.js");
            await handleMakeMiddleware(rawName);
            break;
        }
        case "make:controller": {
            const { handleMakeController } = await import("./commands/make-controller.command.js");
            await handleMakeController(rawName, isModuleFlag);
            break;
        }
        case "make:service": {
            const { handleMakeService } = await import("./commands/make-service.command.js");
            await handleMakeService(rawName, isModuleFlag);
            break;
        }
        case "make:routes": {
            const { handleMakeRoutes } = await import("./commands/make-routes.command.js");
            await handleMakeRoutes(rawName, isModuleFlag);
            break;
        }
        default:
            logger.error(`Comando no reconocido: "${command}"`);
            process.exit(1);
    }
}

main();