const LOOKUP = `
const W = Vencord.Webpack;
const C = W.Common || {};
const A = W.findByProps && W.findByProps("toggleSelfMute", "toggleSelfDeaf");
const ME = C.MediaEngineStore || (W.findByProps && W.findByProps("isSelfMute", "isSelfDeaf"));
const VS = C.VoiceStateStore;
const CH = C.ChannelStore;
const US = C.UserStore;
const SEL = C.SelectedChannelStore;
const IC = C.IconUtils;
`;

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

export class Renderer {
    constructor(cdp) {
        this.cdp = cdp;
    }

    async getVoiceState() {
        return this.cdp.evaluate(`(() => {${LOOKUP}
            if (!ME) return null;
            return { mute: !!ME.isSelfMute(), deaf: !!ME.isSelfDeaf() };
        })()`);
    }

    async setMute(want) {
        return this.cdp.evaluate(`(async () => {${LOOKUP}
            if (!A || !ME) return null;
            if (!!ME.isSelfMute() !== ${!!want}) A.toggleSelfMute();
            const t = Date.now();
            while (!!ME.isSelfMute() !== ${!!want} && Date.now() - t < 3000) {
                await new Promise(r => setTimeout(r, 50));
            }
            return !!ME.isSelfMute();
        })()`);
    }

    async setDeaf(want) {
        return this.cdp.evaluate(`(async () => {${LOOKUP}
            if (!A || !ME) return null;
            if (!!ME.isSelfDeaf() !== ${!!want}) A.toggleSelfDeaf();
            const t = Date.now();
            while (!!ME.isSelfDeaf() !== ${!!want} && Date.now() - t < 3000) {
                await new Promise(r => setTimeout(r, 50));
            }
            return !!ME.isSelfDeaf();
        })()`);
    }

    async getCurrentUser() {
        const user = await this.cdp.evaluate(`(() => {
            const u = Vencord.Webpack.Common.UserStore.getCurrentUser();
            if (!u) return null;
            return {
                id: u.id,
                username: u.username,
                discriminator: u.discriminator ?? "0",
                global_name: u.globalName ?? null,
                avatar: u.avatar ?? null,
                bot: !!u.bot,
                flags: 0,
                premium_type: 0
            };
        })()`);
        return user ?? MOCK_USER;
    }

    async getVoiceSettings() {
        return this.cdp.evaluate(`(() => {${LOOKUP}
            if (!ME) return null;
            const dev = d => Object.values(d || {}).map(x => ({ id: x.id, name: x.name }));
            return {
                automatic_gain_control: false,
                echo_cancellation: false,
                noise_suppression: false,
                qos: false,
                silence_warning: false,
                deaf: !!ME.isSelfDeaf(),
                mute: !!ME.isSelfMute(),
                input: {
                    available_devices: dev(ME.getInputDevices()),
                    device_id: ME.getInputDeviceId(),
                    volume: ME.getInputVolume()
                },
                output: {
                    available_devices: dev(ME.getOutputDevices()),
                    device_id: ME.getOutputDeviceId(),
                    volume: ME.getOutputVolume()
                },
                mode: { type: "VOICE_ACTIVITY", auto_threshold: true, threshold: -60, shortcut: [], delay: 20 }
            };
        })()`);
    }

    async applyVoiceSettings(args = {}) {
        const ARGS = JSON.stringify(args);
        return this.cdp.evaluate(`(async () => {${LOOKUP}
            if (!A || !ME) return null;
            const args = ${ARGS};
            if (typeof args.mute === "boolean" && !!ME.isSelfMute() !== args.mute) A.toggleSelfMute();
            if (typeof args.deaf === "boolean" && !!ME.isSelfDeaf() !== args.deaf) A.toggleSelfDeaf();
            if (args.input) {
                if (typeof args.input.volume === "number") A.setInputVolume(args.input.volume);
                if (args.input.device_id) A.setInputDevice(args.input.device_id);
            }
            if (args.output) {
                if (typeof args.output.volume === "number") A.setOutputVolume(args.output.volume);
                if (args.output.device_id) A.setOutputDevice(args.output.device_id);
            }
            const t = Date.now();
            while (Date.now() - t < 300 && (typeof args.mute === "boolean" && !!ME.isSelfMute() !== args.mute)) {
                await new Promise(r => setTimeout(r, 50));
            }
            return true;
        })()`);
    }

    async getSelectedVoiceChannel() {
        return this.cdp.evaluate(`(() => {${LOOKUP}
            if (!SEL || !CH || !VS || !US || !ME) return null;
            const chId = SEL.getVoiceChannelId();
            if (!chId) return null;
            const ch = CH.getChannel(chId);
            if (!ch) return null;
            const states = VS.getVoiceStatesForChannel(chId) || {};
            const voice_states = Object.values(states).map(s => {
                const u = US.getUser(s.userId);
                return {
                    user: u
                        ? { id: u.id, username: u.username, global_name: u.globalName ?? null, discriminator: u.discriminator ?? "0", avatar: u.avatar ?? null, bot: !!u.bot }
                        : { id: s.userId, username: "unknown", global_name: null, avatar: null, discriminator: "0", bot: false },
                    nick: null,
                    mute: !!s.mute,
                    deaf: !!s.deaf,
                    self_mute: !!s.selfMute,
                    self_deaf: !!s.selfDeaf,
                    suppress: !!s.suppress,
                    session_id: s.sessionId,
                    channel_id: chId,
                    volume: ME.getLocalVolume(s.userId),
                    pan: ME.getLocalPan(s.userId)
                };
            });
            return { id: ch.id, guild_id: ch.guild_id ?? null, name: ch.name ?? null, type: ch.type, voice_states };
        })()`);
    }

    async setUserVoiceSettings(args = {}) {
        const ARGS = JSON.stringify(args);
        return this.cdp.evaluate(`(async () => {${LOOKUP}
            if (!A || !ME) return null;
            const args = ${ARGS};
            const id = args.user_id;
            if (typeof args.volume === "number") A.setLocalVolume(id, args.volume);
            if (args.pan && typeof args.pan.left === "number" && typeof args.pan.right === "number") {
                A.setLocalPan(id, args.pan.left, args.pan.right);
            }
            if (typeof args.mute === "boolean" && !!ME.isLocalMute(id) !== args.mute) A.toggleLocalMute(id);
            await new Promise(r => setTimeout(r, 50));
            return { id, volume: ME.getLocalVolume(id), pan: ME.getLocalPan(id), mute: ME.isLocalMute(id) };
        })()`);
    }

    async selectVoiceChannel(channelId) {
        const id = JSON.stringify(channelId);
        return this.cdp.evaluate(`(() => {${LOOKUP}
            const SV = W.findByProps && W.findByProps("selectVoiceChannel");
            try {
                if (SV && typeof SV.selectVoiceChannel === "function") {
                    SV.selectVoiceChannel(${id});
                    return true;
                }
                C.FluxDispatcher.dispatch({ type: "VOICE_CHANNEL_SELECT", channelId: ${id} });
                return true;
            } catch {
                return false;
            }
        })()`);
    }

    async getUserImage(userId) {
        const id = JSON.stringify(userId);
        return this.cdp.evaluate(`(async () => {
            const C = Vencord.Webpack.Common;
            const u = C.UserStore.getUser(${id});
            if (!u) return null;
            const url = C.IconUtils.getUserAvatarURL(u, false, 128);
            if (!url) return null;
            const res = await fetch(url);
            const bytes = new Uint8Array(await res.arrayBuffer());
            let bin = "";
            for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
            const mime = res.headers.get("content-type") || "image/png";
            return { data_url: "data:" + mime + ";base64," + btoa(bin) };
        })()`);
    }

    async getGuilds() {
        return this.cdp.evaluate(`(() => {
            const C = Vencord.Webpack.Common;
            const guilds = Object.values(C.GuildStore.getGuilds() || {}).map(g => ({
                id: g.id,
                name: g.name,
                icon_url: g.icon ? C.IconUtils.getGuildIconURL(g, 128) : null
            }));
            return { guilds };
        })()`);
    }

    async getGuild(guildId) {
        const id = JSON.stringify(guildId);
        return this.cdp.evaluate(`(() => {
            const C = Vencord.Webpack.Common;
            const g = C.GuildStore.getGuild(${id});
            if (!g) return null;
            return { id: g.id, name: g.name, icon_url: g.icon ? C.IconUtils.getGuildIconURL(g, 128) : null };
        })()`);
    }

    async getChannels(guildId) {
        const id = JSON.stringify(guildId);
        return this.cdp.evaluate(`(() => {
            const C = Vencord.Webpack.Common;
            const all = C.ChannelStore.getMutableGuildChannelsForGuild(${id}) || {};
            const channels = Object.values(all)
                .filter(c => c.type === 0 || c.type === 2 || c.type === 13)
                .map(c => ({ id: c.id, name: c.name, type: c.type, guild_id: c.guild_id ?? ${id} }));
            return { channels };
        })()`);
    }

    async getChannel(channelId) {
        const id = JSON.stringify(channelId);
        return this.cdp.evaluate(`(() => {
            const c = Vencord.Webpack.Common.ChannelStore.getChannel(${id});
            if (!c) return null;
            return { id: c.id, name: c.name ?? null, type: c.type, guild_id: c.guild_id ?? null };
        })()`);
    }

    async forwardActivity(event) {
        const json = JSON.stringify(JSON.stringify(event));
        return this.cdp.evaluate(`(() => {
            const W = Vencord.Webpack;
            const C = W.Common || {};
            const JSON_DATA = ${json};
            const data = JSON.parse(JSON_DATA);

            if (!window.__ddrStreamerMode) {
                window.__ddrStreamerMode = { userDisabled: false };
                C.FluxDispatcher?.subscribe?.("STREAMER_MODE_UPDATE", e => {
                    if (!e.isAuto && !e.value) window.__ddrStreamerMode.userDisabled = true;
                });
            }

            if (data.socketId === "STREAMERMODE" && C.StreamerModeStore?.autoToggle) {
                const value = data.activity?.application_id === "STREAMERMODE";
                if (!value) window.__ddrStreamerMode.userDisabled = false;
                else if (window.__ddrStreamerMode.userDisabled) return "skip";

                C.FluxDispatcher.dispatch({ type: "STREAMER_MODE_UPDATE", key: "enabled", value, isAuto: true });
                return "streamer";
            }

            const p = Vencord.Plugins && Vencord.Plugins.plugins && Vencord.Plugins.plugins["WebRichPresence (arRPC)"];
            if (!p || typeof p.handleEvent !== "function") return false;
            p.handleEvent(new MessageEvent("message", { data: JSON_DATA }));
            return true;
        })()`);
    }

    async handleInvite(code) {
        const c = JSON.stringify(code);
        return this.cdp.evaluate(`(async () => {
            const C = Vencord.Webpack.Common;
            try {
                const { invite } = await C.InviteActions.resolveInvite(${c}, "Desktop Modal");
                if (!invite) return false;
                try { VesktopNative.win.focus(); } catch {}
                C.FluxDispatcher.dispatch({ type: "INVITE_MODAL_OPEN", invite, code: ${c}, context: "APP" });
                return true;
            } catch {
                return false;
            }
        })()`);
    }

    async handleDeepLink(args) {
        const a = JSON.stringify(JSON.stringify(args));
        return this.cdp.evaluate(`(() => {
            const W = Vencord.Webpack;
            let D = null;
            try {
                const mod = W.findLazy && W.findLazy(m => m && typeof m === "object" && m.DEEP_LINK && typeof m.DEEP_LINK.handler === "function");
                D = mod && mod.DEEP_LINK;
            } catch {
                D = null;
            }
            if (!D || typeof D.handler !== "function") return false;
            try {
                D.handler({ args: JSON.parse(${a}) });
                return true;
            } catch {
                return false;
            }
        })()`);
    }
}
