import { DiscordIpcServer } from "./discord-ipc.js";

const MOCK_USER = {
    id: "1045800378228281345",
    username: "arrpc",
    discriminator: "0",
    global_name: "arRPC",
    avatar: "cfefa4d9839fb4bdf030f91c2a13e95c",
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
    constructor(renderer) {
        this.renderer = renderer;
        this.settings = structuredClone(BASE_SETTINGS);
        this.currentUser = null;
        this.sockets = new Set();
        this.socketId = 0;
        this.ipc = new DiscordIpcServer({
            connection: socket => this.#onConnection(socket),
            message: (socket, message) => this.handleMessage(socket, message),
            close: socket => this.#onClose(socket)
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
        socket.socketId = this.socketId++;
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
                user: this.currentUser ?? MOCK_USER
            },
            evt: "READY",
            nonce: null
        });
    }

    #onClose(socket) {
        this.sockets.delete(socket);
        this.renderer
            .forwardActivity({ activity: null, pid: socket.lastPid, socketId: String(socket.socketId) })
            .catch(() => {});
    }

    async handleMessage(socket, { cmd, args, evt, nonce }) {
        switch (cmd) {
            case "AUTHENTICATE": {
                const user = await this.renderer.getCurrentUser().catch(() => null);
                if (user) this.currentUser = user;
                this.#reply(socket, cmd, nonce, { application: MOCK_APPLICATION, user: this.currentUser ?? MOCK_USER });
                return;
            }

            case "GET_VOICE_SETTINGS":
                await this.refresh();
                this.#reply(socket, cmd, nonce, this.settings);
                return;

            case "SET_VOICE_SETTINGS":
                await this.renderer.applyVoiceSettings(args).catch(() => {});
                await this.refresh();
                this.#reply(socket, cmd, nonce, this.settings);
                this.broadcast();
                return;

            case "GET_SELECTED_VOICE_CHANNEL": {
                const channel = await this.renderer.getSelectedVoiceChannel().catch(() => null);
                this.#reply(socket, cmd, nonce, channel);
                return;
            }

            case "SET_USER_VOICE_SETTINGS": {
                const result = await this.renderer.setUserVoiceSettings(args).catch(() => null);
                this.#reply(socket, cmd, nonce, result ?? {});
                return;
            }

            case "GET_IMAGE": {
                if (args?.type !== "user") {
                    this.#reply(socket, cmd, nonce, { data_url: "" });
                    return;
                }
                const image = await this.renderer.getUserImage(args.id).catch(() => null);
                this.#reply(socket, cmd, nonce, image ?? { data_url: "" });
                return;
            }

            case "GET_GUILDS": {
                const guilds = await this.renderer.getGuilds().catch(() => null);
                this.#reply(socket, cmd, nonce, guilds ?? { guilds: [] });
                return;
            }

            case "GET_GUILD": {
                const guild = await this.renderer.getGuild(args?.guild_id).catch(() => null);
                this.#reply(socket, cmd, nonce, guild ?? {});
                return;
            }

            case "GET_CHANNELS": {
                const channels = await this.renderer.getChannels(args?.guild_id).catch(() => null);
                this.#reply(socket, cmd, nonce, channels ?? { channels: [] });
                return;
            }

            case "GET_CHANNEL": {
                const channel = await this.renderer.getChannel(args?.channel_id).catch(() => null);
                this.#reply(socket, cmd, nonce, channel ?? {});
                return;
            }

            case "SELECT_VOICE_CHANNEL":
                await this.renderer.selectVoiceChannel(args?.channel_id ?? null).catch(() => {});
                await new Promise(r => setTimeout(r, 300));
                this.#reply(socket, cmd, nonce, await this.renderer.getSelectedVoiceChannel().catch(() => null));
                return;

            case "SELECT_TEXT_CHANNEL":
                this.#reply(socket, cmd, nonce, {});
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
                this.#handleActivity(socket, args, nonce);
                return;

            case "INVITE_BROWSER":
                this.#handleInvite(socket, args, nonce);
                return;

            case "GUILD_TEMPLATE_BROWSER":
                this.#reply(socket, cmd, nonce, { code: args?.code });
                return;

            case "DEEP_LINK":
                this.renderer
                    .handleDeepLink(args)
                    .then(success => this.#reply(socket, cmd, nonce, null, !success))
                    .catch(() => this.#reply(socket, cmd, nonce, null, true));
                return;

            case "CONNECTIONS_CALLBACK":
                this.#reply(socket, cmd, nonce, { code: 1000 }, true);
                return;

            case "GET_SOUNDBOARD_SOUNDS":
                this.#reply(socket, cmd, nonce, []);
                return;

            default:
                this.#reply(socket, cmd, nonce, {});
        }
    }

    #handleActivity(socket, args = {}, nonce) {
        const { activity, pid } = args;

        if (!activity) {
            this.#reply(socket, "SET_ACTIVITY", nonce, null);
            this.renderer
                .forwardActivity({ activity: null, pid, socketId: String(socket.socketId) })
                .catch(() => {});
            return;
        }

        const { buttons, timestamps, instance } = activity;
        socket.lastPid = pid ?? socket.lastPid;

        const metadata = {};
        const extra = {};
        if (buttons) {
            metadata.button_urls = buttons.map(x => x.url);
            extra.buttons = buttons.map(x => x.label);
        }

        if (timestamps) {
            for (const key in timestamps) {
                if (Date.now().toString().length - timestamps[key].toString().length > 2) {
                    timestamps[key] = Math.floor(1000 * timestamps[key]);
                }
            }
        }

        this.renderer
            .forwardActivity({
                activity: {
                    application_id: socket.clientId,
                    type: 0,
                    metadata,
                    flags: instance ? 1 << 0 : 0,
                    ...activity,
                    ...extra
                },
                pid,
                socketId: String(socket.socketId)
            })
            .catch(() => {});

        this.#reply(socket, "SET_ACTIVITY", nonce, {
            ...activity,
            ...extra,
            name: "",
            application_id: socket.clientId,
            type: 0,
            metadata
        });
    }

    #handleInvite(socket, args, nonce) {
        const { code } = args ?? {};
        this.renderer
            .handleInvite(code)
            .then(valid =>
                this.#reply(socket, "INVITE_BROWSER", nonce, valid ? { code } : { code: 4011, message: `Invalid invite id: ${code}` }, !valid)
            )
            .catch(() => this.#reply(socket, "INVITE_BROWSER", nonce, { code: 4011, message: `Invalid invite id: ${code}` }, true));
    }

    async refresh() {
        const settings = await this.renderer.getVoiceSettings().catch(() => null);
        if (settings) this.settings = settings;
        return this.settings;
    }

    broadcast() {
        const message = { cmd: "DISPATCH", evt: "VOICE_SETTINGS_UPDATE", data: this.settings, nonce: null };
        for (const socket of this.sockets) {
            if (socket.subs?.has("VOICE_SETTINGS_UPDATE")) this.#send(socket, message);
        }
    }

    startPolling(interval = 1000) {
        this.timer = setInterval(async () => {
            if (!this.renderer.cdp.ready) return;
            const before = JSON.stringify(this.settings);
            await this.refresh().catch(() => {});
            if (before !== JSON.stringify(this.settings)) this.broadcast();

            this.renderer.getCurrentUser().then(u => {
                if (u) this.currentUser = u;
            }).catch(() => {});
        }, interval);
        this.timer.unref?.();
    }

    stop() {
        clearInterval(this.timer);
        this.ipc.close();
    }
}
