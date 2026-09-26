const MODULE_LOOKUP = `
const W = Vencord.Webpack;
const A = W.findByProps && W.findByProps("toggleSelfMute", "toggleSelfDeaf");
const C = W.Common || {};
const ME = C.MediaEngineStore || (W.findByProps && W.findByProps("isSelfMute", "isSelfDeaf"));
`;

export class Renderer {
    constructor(cdp) {
        this.cdp = cdp;
    }

    async getVoiceState() {
        return this.cdp.evaluate(`(() => {${MODULE_LOOKUP}
            if (!ME) return null;
            return { mute: !!ME.isSelfMute(), deaf: !!ME.isSelfDeaf() };
        })()`);
    }

    async setMute(want) {
        return this.cdp.evaluate(`(async () => {${MODULE_LOOKUP}
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
        return this.cdp.evaluate(`(async () => {${MODULE_LOOKUP}
            if (!A || !ME) return null;
            if (!!ME.isSelfDeaf() !== ${!!want}) A.toggleSelfDeaf();
            const t = Date.now();
            while (!!ME.isSelfDeaf() !== ${!!want} && Date.now() - t < 3000) {
                await new Promise(r => setTimeout(r, 50));
            }
            return !!ME.isSelfDeaf();
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
