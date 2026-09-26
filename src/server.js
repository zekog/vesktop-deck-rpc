import { DiscordIpcServer } from "./discord-ipc.js";

const MOCK_USER = {
    id: "1045800378228281345",
    username: "arrpc",
    discriminator: "0",
    global_name: "arRPC",
    avatar: "cfefa4d9839fb4bdf030f91c2a13e95c",
    avatar_decoration_data: null,
    bot: false,
    flags: 0,
    premium_type: 0
};

const MOCK_APPLICATION = {
    id: "0",
    name: "arRPC",
    description: "",
    icon: null,
    cover_image: null
};

const BASE_SETTINGS = {
    automatic_gain_control: false,
    echo_cancellation: false,
    noise_suppression: false,
    qos: false,
    silence_warning: false,
    deaf: false,
    mute: false,
    input: { available_devices: [], device_id: "default", volume: 100 },
    output: { available_devices: [], device_id: "default", volume: 100 },
    mode: { type: "VOICE_ACTIVITY", auto_threshold: true, threshold: -60, shortcut: [], delay: 20 }
};

export class RpcServer {
    constructor(voice) {
        this.voice = voice;
        this.settings = structuredClone(BASE_SETTINGS);
        this.sockets = new Set();
        this.ipc = new DiscordIpcServer({
            connection: socket => this.#onConnection(socket),
            message: (socket, message) => this.#onMessage(socket, message),
            close: socket => this.sockets.delete(socket)
        });
    }

    async start() {
        await this.ipc.listen();
        return this;
    }

    #send(socket, message) {
        socket.send?.(message);
    }

    #reply(socket, cmd, nonce, data, isError = false) {
        this.#send(socket, { cmd, data, evt: isError ? "ERROR" : null, nonce });
    }

    #onConnection(socket) {
        this.sockets.add(socket);
        this.#send(socket, {
            cmd: "DISPATCH",
            data: {
                v: 1,
                config: {
                    cdn_host: "cdn.discordapp.com",
                    api_endpoint: "//discord.com/api",
                    environment: "production"
                },
                user: MOCK_USER
            },
            evt: "READY",
            nonce: null
        });
    }

    async #onMessage(socket, { cmd, args, evt, nonce }) {
        switch (cmd) {
            case "AUTHENTICATE":
                this.#reply(socket, cmd, nonce, { application: MOCK_APPLICATION, user: MOCK_USER });
                return;

            case "GET_VOICE_SETTINGS":
                await this.refresh();
                this.#reply(socket, cmd, nonce, this.settings);
                return;

            case "SET_VOICE_SETTINGS":
                await this.apply(args);
                this.#reply(socket, cmd, nonce, this.settings);
                this.broadcast();
                return;

            case "SUBSCRIBE":
                socket.subs ??= new Set();
                socket.subs.add(evt);
                this.#reply(socket, cmd, nonce, {});
                return;

            case "UNSUBSCRIBE":
                socket.subs?.delete(evt);
                this.#reply(socket, cmd, nonce, {});
                return;

            case "SET_ACTIVITY":
                this.forwardActivity(socket, args).catch(() => {});
                this.#reply(socket, cmd, nonce, {});
                return;

            case "GET_GUILDS":
                this.#reply(socket, cmd, nonce, { guilds: [] });
                return;

            case "GET_CHANNELS":
                this.#reply(socket, cmd, nonce, { channels: [] });
                return;

            case "GET_SOUNDBOARD_SOUNDS":
                this.#reply(socket, cmd, nonce, []);
                return;

            default:
                this.#reply(socket, cmd, nonce, {});
        }
    }

    async refresh() {
        const state = await this.voice.getState().catch(() => null);
        if (state) {
            this.settings.mute = state.mute;
            this.settings.deaf = state.deaf;
        }
        return this.settings;
    }

    async apply(args = {}) {
        if (typeof args.mute === "boolean") {
            const result = await this.voice.setMute(args.mute).catch(() => null);
            if (typeof result === "boolean") this.settings.mute = result;
        }
        if (typeof args.deaf === "boolean") {
            const result = await this.voice.setDeaf(args.deaf).catch(() => null);
            if (typeof result === "boolean") this.settings.deaf = result;
        }
        await this.refresh();
    }

    async forwardActivity(socket, { activity, pid } = {}) {
        if (!activity) {
            await this.voice.forwardActivity({ activity: null, pid, socketId: String(socket.clientId ?? "deck") });
            return;
        }

        const translated = { application_id: socket.clientId, type: 0, ...activity };
        if (activity.buttons) {
            translated.metadata = { button_urls: activity.buttons.map(b => b.url) };
            translated.buttons = activity.buttons.map(b => b.label);
        }
        if (activity.timestamps) {
            for (const key of Object.keys(activity.timestamps)) {
                const value = activity.timestamps[key];
                if (typeof value === "number" && Date.now().toString().length - value.toString().length > 2) {
                    translated.timestamps[key] = Math.floor(value * 1000);
                }
            }
        }

        await this.voice.forwardActivity({ activity: translated, pid, socketId: String(socket.clientId ?? "deck") });
    }

    broadcast() {
        const message = { cmd: "DISPATCH", evt: "VOICE_SETTINGS_UPDATE", data: this.settings, nonce: null };
        for (const socket of this.sockets) {
            if (socket.subs?.has("VOICE_SETTINGS_UPDATE")) this.#send(socket, message);
        }
    }

    startPolling(interval = 1000) {
        this.timer = setInterval(async () => {
            if (!this.voice.cdp.ready) return;
            const before = `${this.settings.mute}:${this.settings.deaf}`;
            await this.refresh().catch(() => {});
            if (before !== `${this.settings.mute}:${this.settings.deaf}`) this.broadcast();
        }, interval);
        this.timer.unref?.();
    }

    stop() {
        clearInterval(this.timer);
        this.ipc.close();
    }
}
