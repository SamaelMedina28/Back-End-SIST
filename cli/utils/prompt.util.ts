import readline from "readline";
// Utilidad para preguntar en consola si sobreescribimos
export function askQuestion(query: string): Promise<boolean> {
    const rl = readline.createInterface({
        input: process.stdin as unknown as NodeJS.ReadableStream,
        output: process.stdout as unknown as NodeJS.WritableStream,
    });

    return new Promise((resolve) => {
        rl.question(`${query} (y/N): `, (answer) => {
            rl.close();
            resolve(answer.trim().toLowerCase() === "y");
        });
    });
}