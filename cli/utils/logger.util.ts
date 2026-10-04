import figlet from "figlet";
import pc from "picocolors";

/**
 * Muestra el banner ASCII de VANE con estilo en la consola
 */
export function printBanner(): void {
    const title = figlet.textSync("VANE", {
        font: "Standard",
        horizontalLayout: "default",
        verticalLayout: "default",
    });

    console.log(pc.magenta(pc.bold(title)));
    console.log(pc.dim("─── CLI Generator & Architecture Suite ───\n"));
}

/**
 * Muestra el menú de ayuda formateado
 */
export function printHelp(): void {
    printBanner();
    
    console.log(pc.bold(pc.cyan("USO:")));
    console.log(`  ${pc.green("vane")} ${pc.yellow("<Modelo>")}                 ${pc.dim("→ Genera módulo completo (schema, controller, service, routes)")}`);
    console.log(`  ${pc.green("vane make:all")} ${pc.yellow("<Modelo>")}        ${pc.dim("→ Genera módulo completo desde prisma/schema.prisma")}`);
    console.log(`  ${pc.green("vane make:controller")} ${pc.yellow("<Nombre>")} ${pc.dim("→ Genera un controlador")}`);
    console.log(`  ${pc.green("vane make:service")} ${pc.yellow("<Nombre>")}    ${pc.dim("→ Genera un servicio")}`);
    console.log(`  ${pc.green("vane make:routes")} ${pc.yellow("<Nombre>")}     ${pc.dim("→ Genera un archivo de rutas")}`);
    console.log(`  ${pc.green("vane make:middleware")} ${pc.yellow("<Nombre>")} ${pc.dim("→ Genera un middleware")}\n`);

    console.log(pc.bold(pc.cyan("OPCIONES:")));
    console.log(`  ${pc.yellow("-m, --module")}                     ${pc.dim("→ Fuerza la creación dentro de src/modules/<Nombre>/")}\n`);
}

/**
 * Utilidades para mensajes formateados
 */
export const logger = {
    info: (msg: string) => console.log(`${pc.blue("ℹ")} ${msg}`),
    success: (msg: string) => console.log(`${pc.green("✔")} ${pc.bold(msg)}`),
    warn: (msg: string) => console.log(`${pc.yellow("⚠")} ${pc.yellow(msg)}`),
    error: (msg: string) => console.log(`${pc.red("✖")} ${pc.red(pc.bold(msg))}`),
    step: (file: string, path: string) => 
        console.log(`  ${pc.gray("├─")} ${pc.bold(pc.white(file))}: ${pc.cyan(path)}`),
};