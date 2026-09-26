import { EventEmitter } from "node:events";

const DEBUG_PORT = Number(process.env.VESKTOP_DEBUG_PORT || 9222);

export async function findDiscordTarget() {
    const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
    const targets = await res.json();
    return (
        targets.find(t => t.type === "page" && /discord\.com/.test(t.url)) ??
        targets.find(t => t.type === "page") ??
        null
    );
}

export class CDP extends EventEmitter {
    constructor() {
        super();
        this.ws = null;
        this.id = 0;
        this.pending = new Map();
        this.ready = false;
        this.targetUrl = null;
    }

    async connect() {
        const target = await findDiscordTarget();
        if (!target?.webSocketDebuggerUrl) {
            throw new Error("no debuggable Vesktop page found");
        }

        await new Promise((resolve, reject) => {
            const ws = new WebSocket(target.webSocketDebuggerUrl);
            this.ws = ws;
            const onError = () => reject(new Error("CDP websocket error"));
            ws.addEventListener("open", () => {
                ws.removeEventListener("error", onError);
                resolve();
            });
            ws.addEventListener("error", onError, { once: true });
            ws.addEventListener("message", ev => this.#onMessage(ev.data));
            ws.addEventListener("close", () => {
                this.ready = false;
                this.ws = null;
                this.emit("close");
            });
        });

        this.ready = true;
        this.targetUrl = target.url;
        return this;
    }

    #onMessage(raw) {
        let msg;
        try {
            msg = JSON.parse(raw);
        } catch {
            return;
        }
        if (msg.id && this.pending.has(msg.id)) {
            const { resolve, reject } = this.pending.get(msg.id);
            this.pending.delete(msg.id);
            if (msg.error) reject(new Error(msg.error.message));
            else resolve(msg.result);
        }
    }

    send(method, params = {}) {
        return new Promise((resolve, reject) => {
            if (!this.ws) return reject(new Error("CDP not connected"));
            const id = ++this.id;
            this.pending.set(id, { resolve, reject });
            this.ws.send(JSON.stringify({ id, method, params }));
        });
    }

    async evaluate(expression) {
        const r = await this.send("Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise: true
        });
        if (r.exceptionDetails) {
            throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || "evaluate failed");
        }
        return r.result?.value;
    }

    close() {
        this.ws?.close();
    }
}
