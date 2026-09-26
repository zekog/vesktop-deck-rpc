import { CDP } from "./cdp.js";
import { RpcServer } from "./server.js";
import { Voice } from "./voice.js";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
    const cdp = new CDP();
    const voice = new Voice(cdp);
    const server = new RpcServer(voice);

    let connecting = false;
    async function connectCdp() {
        if (connecting || cdp.ready) return;
        connecting = true;
        try {
            await cdp.connect();
            console.log(`[cdp] connected to Vesktop: ${cdp.targetUrl}`);
        } catch {
            connecting = false;
            setTimeout(connectCdp, 2000);
            return;
        }
        connecting = false;
        cdp.once("close", () => {
            console.log("[cdp] disconnected, waiting for Vesktop...");
            setTimeout(connectCdp, 2000);
        });
    }

    try {
        await server.start();
        console.log("[ipc] listening on discord-ipc-0");
    } catch (e) {
        console.error("[ipc] failed to bind discord-ipc-0:", e.message);
        console.error("[ipc] is Vesktop's built-in arRPC still enabled? Disable it and restart Vesktop.");
        process.exit(1);
    }

    await connectCdp();
    server.startPolling();

    const shutdown = () => {
        console.log("\n[main] shutting down");
        server.stop();
        cdp.close();
        process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    console.log("[main] ready — Stream Deck / OpenDeck can now control Vesktop voice");
}

main().catch(e => {
    console.error("[main] fatal:", e);
    process.exit(1);
});
