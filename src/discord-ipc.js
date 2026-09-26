import net from "node:net";
import { unlinkSync } from "node:fs";
import { join } from "node:path";

const TYPES = { HANDSHAKE: 0, FRAME: 1, CLOSE: 2, PING: 3, PONG: 4 };

const SOCKET_PATH = join(
    process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || process.env.TMP || process.env.TEMP || "/tmp",
    "discord-ipc-0"
);

function encode(type, data) {
    const json = Buffer.from(JSON.stringify(data));
    const buf = Buffer.alloc(8 + json.length);
    buf.writeInt32LE(type, 0);
    buf.writeInt32LE(json.length, 4);
    json.copy(buf, 8);
    return buf;
}

function isSocketAlive(path) {
    return new Promise(resolve => {
        const socket = net.createConnection(path);
        const done = value => {
            try {
                socket.destroy();
            } catch {}
            resolve(value);
        };
        socket.once("connect", () => done(true));
        socket.once("error", () => done(false));
        setTimeout(() => done(false), 500).unref();
    });
}

export class DiscordIpcServer {
    constructor(handlers) {
        this.handlers = handlers;
        this.clients = new Set();
    }

    async listen() {
        const server = net.createServer(socket => this.#onConnection(socket));

        await new Promise((resolve, reject) => {
            let retried = false;
            const attempt = () => server.listen(SOCKET_PATH, () => resolve());
            server.on("error", async err => {
                if (err.code === "EADDRINUSE" && !retried && !(await isSocketAlive(SOCKET_PATH))) {
                    retried = true;
                    try {
                        unlinkSync(SOCKET_PATH);
                    } catch {}
                    attempt();
                } else {
                    reject(err);
                }
            });
            attempt();
        });

        this.server = server;
        return this;
    }

    #onConnection(socket) {
        socket._handshook = false;
        let buf = Buffer.alloc(0);

        socket.send = obj => {
            if (!socket.destroyed) socket.write(encode(TYPES.FRAME, obj));
        };

        const handle = (type, data) => {
            switch (type) {
                case TYPES.PING:
                    socket.write(encode(TYPES.PONG, data));
                    return;
                case TYPES.CLOSE:
                    socket.end();
                    socket.destroy();
                    return;
                case TYPES.HANDSHAKE:
                    if (socket._handshook) return;
                    socket._handshook = true;
                    socket.clientId = data?.client_id ?? "";
                    this.handlers.connection(socket);
                    return;
                case TYPES.FRAME:
                    if (!socket._handshook) return;
                    this.handlers.message(socket, data);
                    return;
            }
        };

        socket.on("data", chunk => {
            buf = Buffer.concat([buf, chunk]);
            while (buf.length >= 8) {
                const type = buf.readInt32LE(0);
                const size = buf.readInt32LE(4);
                if (buf.length < 8 + size) break;
                let data = null;
                try {
                    data = JSON.parse(buf.subarray(8, 8 + size).toString());
                } catch {}
                buf = buf.subarray(8 + size);
                try {
                    handle(type, data);
                } catch (e) {
                    console.error("[ipc] handler error:", e);
                }
            }
        });

        socket.on("error", () => {});
        socket.on("close", () => {
            this.clients.delete(socket);
            this.handlers.close?.(socket);
        });

        this.clients.add(socket);
    }

    close() {
        this.server?.close();
        for (const socket of this.clients) socket.destroy();
    }
}
