import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";

import * as Natives from "./process/native/index.js";

const Native = Natives[process.platform];

const databasePath =
    process.env.ARRPC_DETECTABLE_CACHE_PATH ||
    join(process.env.XDG_CACHE_HOME || join(os.homedir(), ".cache"), "vesktop-deck-rpc", "detectable.json");

const log = (...args) => console.log("[process]", ...args);

async function getDatabase(lastModified) {
    const res = await fetch("https://discord.com/api/v9/applications/detectable", {
        method: "GET",
        headers: lastModified ? { "If-Modified-Since": lastModified } : {}
    });

    if (res.status === 304) return false;
    if (res.status !== 200) throw new Error(`http code ${res.status}`);

    const data = await res.text();
    await fs.promises.mkdir(join(databasePath, ".."), { recursive: true });
    await fs.promises.writeFile(databasePath, JSON.stringify(JSON.parse(data)), "utf8");
    return true;
}

const timestamps = {};
const names = {};
const pids = {};

export default class ProcessServer {
    constructor(handlers) {
        if (!Native?.getProcesses) return;

        this.handlers = handlers;
        this.DetectableDB = [];
        this.scan = this.scan.bind(this);

        this.initializeDatabase().then(() => {
            this.scan();
            this.interval = setInterval(this.scan, 5000);
            this.interval.unref?.();
            log("process scanning started");
        });
    }

    async loadDB() {
        try {
            this.DetectableDB = JSON.parse(await fs.promises.readFile(databasePath, "utf-8"));
            this.DetectableDB.push({
                aliases: ["Obs"],
                executables: [
                    { is_launcher: false, name: "obs", os: "linux" },
                    { is_launcher: false, name: "obs.exe", os: "win32" },
                    { is_launcher: false, name: "obs.app", os: "darwin" }
                ],
                hook: true,
                id: "STREAMERMODE",
                name: "OBS"
            });
        } catch (e) {
            fs.promises.unlink(databasePath).catch(() => {});
            log("could not load the database:", e.message);
        }
    }

    async initializeDatabase() {
        const stats = await fs.promises.stat(databasePath).catch(() => null);
        if (stats && Date.now() - stats.mtime.getTime() < 24 * 60 * 60 * 1000) {
            await this.loadDB();
            return;
        }

        const age = stats?.mtime.toUTCString() ?? null;
        await getDatabase(age)
            .catch(error => log(`${error}.. continuing with old database`));

        await this.loadDB();
    }

    async scan() {
        const processes = await Native.getProcesses().catch(() => []);
        const ids = [];

        for (const [pid, path, args] of processes) {
            const splitPath = path.toLowerCase().replaceAll("\\", "/").split("/");
            if ((splitPath[0].length === 2 && splitPath[0].endsWith(":")) || splitPath[0] === "") {
                splitPath.shift();
            }

            const toCompare = [];
            for (let i = 0; i < splitPath.length; i++) {
                toCompare.push(splitPath.slice(-i).join("/"));
            }
            for (const p of toCompare.slice()) {
                toCompare.push(p.replace("64", ""));
                toCompare.push(p.replace(".x64", ""));
                toCompare.push(p.replace("x64", ""));
                toCompare.push(p.replace("_64", ""));
            }

            for (const { executables, id, name } of this.DetectableDB) {
                const matched = executables?.some(x => {
                    if (x.is_launcher) return false;
                    if (x.name[0] === ">" ? x.name.substring(1) !== toCompare[0] : !toCompare.some(y => x.name === y)) return false;
                    if (args && x.arguments) return args.join(" ").indexOf(x.arguments) > -1;
                    return true;
                });

                if (!matched) continue;

                names[id] = name;
                pids[id] = pid;
                ids.push(id);

                if (!timestamps[id]) {
                    log("detected game!", name);
                    timestamps[id] = Date.now();
                }

                this.handlers.message(
                    { socketId: id },
                    {
                        cmd: "SET_ACTIVITY",
                        args: {
                            activity: {
                                application_id: id,
                                name,
                                timestamps: { start: timestamps[id] }
                            },
                            pid
                        }
                    }
                );
            }
        }

        for (const id in timestamps) {
            if (!ids.includes(id)) {
                log("lost game!", names[id]);
                delete timestamps[id];
                this.handlers.message(
                    { socketId: id },
                    { cmd: "SET_ACTIVITY", args: { activity: null, pid: pids[id] } }
                );
            }
        }
    }

    stop() {
        clearInterval(this.interval);
    }
}
