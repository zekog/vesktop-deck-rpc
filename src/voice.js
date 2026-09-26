const MODULE_LOOKUP = `
const W = Vencord.Webpack;
const A = W.findByProps && W.findByProps("toggleSelfMute", "toggleSelfDeaf");
const C = W.Common || {};
const ME = C.MediaEngineStore || (W.findByProps && W.findByProps("isSelfMute", "isSelfDeaf"));
`;

export class Voice {
    constructor(cdp) {
        this.cdp = cdp;
    }

    async getState() {
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

    async forwardActivity(data) {
        const payload = JSON.stringify(JSON.stringify(data));
        return this.cdp.evaluate(`(() => {
            const p = Vencord.Plugins && Vencord.Plugins.plugins && Vencord.Plugins.plugins["WebRichPresence (arRPC)"];
            if (!p || typeof p.handleEvent !== "function") return false;
            p.handleEvent(new MessageEvent("message", { data: ${payload} }));
            return true;
        })()`);
    }
}
