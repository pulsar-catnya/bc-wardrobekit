// Mathematics never lies


 
(() => {
"use strict";

 

const WKNow = () => Date.now();
const WKTabVisible = () => !(typeof document !== "undefined" && document.hidden);
const WKLog = (...a) => console.log("[WardrobeKit]", ...a);
const WKErr = (...a) => console.error("[WardrobeKit]", ...a);

const WKStorage = {
	get(key) {
		try { return localStorage.getItem(key); } catch (e) { return null; }
	},
	set(key, value) {
		try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
	},
	remove(key) {
		try { localStorage.removeItem(key); } catch (e) { }
	},
};

function WKDeepClone(x) {
	if (x === undefined || x === null) return x;
	try { return JSON.parse(JSON.stringify(x)); } catch (e) { return x; }
}

 
const WKColorPattern = new RegExp("^#?([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$");

function WKNormalizeColor(s) {
	if (typeof s !== "string") return null;
	const m = String(s).trim().match(WKColorPattern);
	if (!m) return null;
	return "#" + m[1].toUpperCase();
}

function WKHexOf(v) {
	return WKNormalizeColor(v);
}

 

const WKStore = {
	accountNum: null,
	state: null,
	_dirty: false,
	_lastDiskRaw: null,
	_lastWritten: null,
	_pendingTimer: null,

	baseKey() {
		return "WardrobeKitData:" + (this.accountNum ?? 0);
	},

	emptyState() {
		return {
			v: 1,
			settings: { historyKeep: 50, paletteMax: 24 },
			palette: [],
			chars: {},
			cur: null,
		};
	},

	 
	normalize(s) {
		if (!s || typeof s !== "object") s = this.emptyState();
		s.v = 1;
		if (!s.settings || typeof s.settings !== "object") s.settings = {};
		const keepRaw = s.settings.historyKeep | 0;
		s.settings.historyKeep = (keepRaw >= 10 && keepRaw <= 300) ? keepRaw : 50;
		const pmRaw = s.settings.paletteMax | 0;
		s.settings.paletteMax = (pmRaw >= 8 && pmRaw <= 48) ? pmRaw : 24;

		if (!Array.isArray(s.palette)) s.palette = [];
		const seen = {};
		s.palette = s.palette
			.filter(e => e && typeof e === "object" && WKHexOf(e.hex))
			.map(e => ({
				hex: WKHexOf(e.hex),
				t: (typeof e.t === "number" && isFinite(e.t)) ? e.t : WKNow(),
				src: e.src === "manual" ? "manual" : "auto",
			}))
			.filter(e => {
				if (seen[e.hex]) return false;
				seen[e.hex] = true;
				return true;
			})
			.slice(0, s.settings.paletteMax);

		if (!s.chars || typeof s.chars !== "object" || Array.isArray(s.chars)) s.chars = {};
		for (const key of Object.keys(s.chars)) {
			const c = s.chars[key];
			const num = Number(key);
			if (!Number.isInteger(num) || num < 0 || !c || typeof c !== "object") { delete s.chars[key]; continue; }
			c.num = num;
			if (typeof c.name !== "string") c.name = "";
			if (typeof c.nick !== "string") c.nick = "";
			if (!Array.isArray(c.history)) c.history = [];
			c.history = c.history.filter(e => e && typeof e === "object" &&
				typeof e.t === "number" && typeof e.label === "string" && Array.isArray(e.appearance));
			for (const e of c.history) {
				e.appearance = WKSanitizeBundle(e.appearance);
				if (typeof e.chip !== "string") e.chip = null;
				e.hash = WKHashOf(e.appearance);
			}
			if (!Number.isInteger(c.cursor) || c.cursor < 0) c.cursor = 0;
			if (c.history.length === 0) c.cursor = 0;
			else c.cursor = Math.min(c.cursor, c.history.length - 1);
			WKTrimHistory(c, s.settings.historyKeep);
		}
		if (s.cur !== null && !s.chars[String(s.cur)]) s.cur = null;
		return s;
	},

	load() {
		if (this.state) return this.state;
		this.state = this.normalize(this.emptyState());
		this._lastDiskRaw = null;
		if (this.accountNum !== null && this.accountNum > 0) {
			const raw = WKStorage.get(this.baseKey());
			this._lastDiskRaw = raw;
			if (raw) {
				try {
					const s = WKParseRaw(raw);
					if (s && typeof s === "object") this.state = this.normalize(s);
				} catch (e) { }
			}
		}
		return this.state;
	},

	 
	save() {
		if (!this.state) return false;
		if (this.accountNum === null || this.accountNum < 1) return false;
		const key = this.baseKey();
		const raw = WKStorage.get(key);
		if (raw !== this._lastDiskRaw) {
			this._lastDiskRaw = raw;
			if (raw) {
				try {
					const disk = WKParseRaw(raw);
					if (disk && typeof disk === "object") {
						if (WKMergeInto(this.state, disk)) WKUI.dirty = true;
					}
				} catch (e) { }
			}
		}
		if (!this._dirty) return false;
		let json;
		try { json = WKSerializeState(this.state); } catch (e) { return false; }
		if (!json) {
			 
			try { json = JSON.stringify(this.state); } catch (e) { return false; }
		}
		if (json === this._lastWritten) return false;
		this._lastWritten = json;
		this._lastDiskRaw = json;
		this._dirty = false;
		return WKStorage.set(key, json);
	},

	requestSave() {
		this._dirty = true;
		if (this._pendingTimer) clearTimeout(this._pendingTimer);
		this._pendingTimer = setTimeout(() => { try { this.save(); } catch (e) { } }, 400);
	},

	ensureAccount(num) {
		if (!Number.isInteger(num) || num < 0) return;
		if (this.accountNum === num) return;
		if (this.accountNum !== null && this.accountNum > 0 && this.state) this.save();
		this.accountNum = num;
		this._dirty = false;
		this._lastDiskRaw = null;
		this._lastWritten = null;
		this.state = null;
		this.load();
	},
};

 
function WKMergeInto(target, disk) {
	let changed = false;
	if (disk && Array.isArray(disk.palette)) {
		const have = {};
		target.palette.forEach(e => { have[e.hex] = true; });
		for (const e of disk.palette) {
			if (!e || typeof e !== "object") continue;
			const hex = WKHexOf(e.hex);
			if (!hex || have[hex]) continue;
			target.palette.unshift({ hex, t: e.t || WKNow(), src: e.src === "manual" ? "manual" : "auto" });
			have[hex] = true;
			changed = true;
		}
		target.palette = target.palette.slice(0, target.settings.paletteMax);
	}
	if (disk && disk.chars && typeof disk.chars === "object") {
		for (const key of Object.keys(disk.chars)) {
			const d = disk.chars[key];
			if (!d || typeof d !== "object") continue;
			const mine = target.chars[key];
			if (!mine) {
				target.chars[key] = WKDeepClone(d);
				changed = true;
			} else if (Array.isArray(d.history) && d.history.length > mine.history.length) {
				target.chars[key] = WKDeepClone(d);
				changed = true;
			}
		}
	}
	return changed;
}

 

 
function WKCompressUTF16(input) {
	if (input === null || input === undefined) return "";
	if (input === "") return "";
	const dictionary = new Map();
	let nextCode = 3;
	const data = [];
	let dataVal = 0, dataPos = 0;
	const writeBit = (b) => {
		dataVal = (dataVal << 1) | (b & 1);
		if (dataPos === 15) { dataPos = 0; data.push(dataVal); dataVal = 0; }
		else dataPos++;
	};
	const writeCodeLSB = (v, bits) => {
		for (let i = 0; i < bits; i++) { writeBit(v & 1); v = v >> 1; }
	};
	const bitsFor = (n) => {
		let b = 3;
		while ((1 << b) <= n) b++;
		return b;
	};
	const emitEntry = (w) => {
		if (w === "") return;
		if (w.length === 1) {
			const ch = w.charCodeAt(0);
			if (ch < 256) { writeCodeLSB(0, bitsFor(nextCode)); writeCodeLSB(ch, 8); }
			else { writeCodeLSB(1, bitsFor(nextCode)); writeCodeLSB(ch, 16); }
		} else {
			writeCodeLSB(dictionary.get(w), bitsFor(nextCode));
		}
	};
	let w = "";
	for (let i = 0; i < input.length; i++) {
		const c = input.charAt(i);
		const wc = w + c;
		if (wc.length > 1 && dictionary.has(wc)) {
			w = wc;
		} else {
			emitEntry(w);
			if (wc.length > 1) dictionary.set(wc, nextCode++);
			w = c;
		}
	}
	emitEntry(w);
	writeCodeLSB(2, bitsFor(nextCode));
	 
	while (true) {
		dataVal = (dataVal << 1);
		if (dataPos === 15) { data.push(dataVal); break; }
		dataPos++;
	}
	let out = "";
	for (let i = 0; i < data.length; i++) out += String.fromCharCode(data[i]);
	return out;
}

 
function WKDecompressUTF16(input) {
	if (input === null || input === undefined) return "";
	if (input === "") return "";
	const dictionary = [];
	let nextCode = 3;
	let w = "";
	const result = [];
	const data = { val: input, pos: 0, idx: 0x8000 };
	const readBit = () => {
		const r = (data.val.charCodeAt(data.pos) & data.idx) > 0 ? 1 : 0;
		data.idx = data.idx >> 1;
		if (data.idx === 0) { data.idx = 0x8000; data.pos++; }
		return r;
	};
	const readCodeLSB = (bits) => {
		let v = 0;
		for (let i = 0; i < bits; i++) v |= readBit() << i;
		return v;
	};
	const bitsFor = (n) => {
		let b = 3;
		while ((1 << b) <= n) b++;
		return b;
	};
	while (true) {
		 
		const code = readCodeLSB(bitsFor(nextCode + 1));
		if (code === 2) return result.join("");
		let entry;
		if (code === 0) entry = String.fromCharCode(readCodeLSB(8));
		else if (code === 1) entry = String.fromCharCode(readCodeLSB(16));
		else if (code < nextCode) entry = dictionary[code];
		else if (code === nextCode) entry = w + w.charAt(0);
		else return null;
		result.push(entry);
		if (w !== "") dictionary[nextCode++] = w + entry.charAt(0);
		w = entry;
	}
}

 
function WKItemCompactOf(it) {
	if (!it || typeof it !== "object") return [null, null];
	const a = [it.Group, it.Name, it.Color !== undefined ? it.Color : null];
	if (it.Property !== undefined && it.Property !== null && typeof it.Property === "object" && Object.keys(it.Property).length > 0) {
		a.push("P", it.Property);
	}
	if (it.Craft !== undefined) a.push("C", it.Craft);
	return a;
}

function WKItemExpandOf(a) {
	if (!Array.isArray(a) || a.length < 2) return null;
	const it = { Group: a[0], Name: a[1] };
	if (a.length > 2 && a[2] !== null) it.Color = a[2];
	for (let i = 3; i < a.length; i++) {
		if (a[i] === "P" && i + 1 < a.length) { it.Property = a[i + 1]; i++; }
		else if (a[i] === "C" && i + 1 < a.length) { it.Craft = a[i + 1]; i++; }
	}
	return it;
}

 
function WKSerializeState(state) {
	try {
		const pool = [];
		const poolIdx = new Map();
		const intern = (item) => {
			if (!item || typeof item !== "object") return -1;
			const key = JSON.stringify(item);
			let idx = poolIdx.get(key);
			if (idx === undefined) {
				idx = pool.length;
				poolIdx.set(key, idx);
				pool.push(WKItemCompactOf(item));
			}
			return idx;
		};
		const chars = {};
		for (const key of Object.keys(state.chars || {})) {
			const c = state.chars[key];
			if (!c || typeof c !== "object") continue;
			chars[key] = {
				n: c.name || "",
				k: c.nick || "",
				u: c.cursor | 0,
				l: c.last || 0,
				h: (c.history || []).map(e => [
					e.t, e.label,
					e.chip || null,
					(e.appearance || []).map(intern),
				]),
			};
		}
		const compact = {
			v: 2,
			s: state.settings || {},
			p: (state.palette || []).map(e => [e.hex, e.t, e.src === "manual" ? 1 : 0]),
			c: chars,
			pool,
			u: (state.cur !== null && state.cur !== undefined) ? state.cur : null,
		};
		let json;
		try { json = JSON.stringify(compact); } catch (e) { return null; }
		try {
			const comp = WKCompressUTF16(json);
			if (comp && comp.length < json.length) return "WKZ1" + comp;
		} catch (e) { }
		return "WKJ1" + json;
	} catch (e) {
		WKErr("存储序列化失败", e);
		return null;
	}
}

 
function WKExpandCompact(compact) {
	if (!compact || typeof compact !== "object") return null;
	const pool = Array.isArray(compact.pool) ? compact.pool.map(WKItemExpandOf) : [];
	const chars = {};
	for (const key of Object.keys(compact.c || {})) {
		const c = compact.c[key];
		if (!c || typeof c !== "object") continue;
		const history = (Array.isArray(c.h) ? c.h : []).map(e => {
			const items = [];
			if (Array.isArray(e) && Array.isArray(e[3])) {
				for (const idx of e[3]) {
					if (Number.isInteger(idx) && idx >= 0 && idx < pool.length && pool[idx]) items.push(pool[idx]);
				}
			}
			const appearance = items;
			return {
				t: (Array.isArray(e) && typeof e[0] === "number") ? e[0] : WKNow(),
				label: (Array.isArray(e) && typeof e[1] === "string") ? e[1] : WKT("stepAdjust"),
				chip: (Array.isArray(e) && typeof e[2] === "string") ? e[2] : null,
				appearance,
				hash: WKHashOf(appearance),
			};
		});
		chars[key] = {
			num: Number(key),
			name: typeof c.n === "string" ? c.n : "",
			nick: typeof c.k === "string" ? c.k : "",
			history,
			cursor: c.u | 0,
			last: c.l || 0,
		};
	}
	return {
		v: 1,
		settings: (compact.s && typeof compact.s === "object") ? compact.s : {},
		palette: (Array.isArray(compact.p) ? compact.p : []).map(e => ({
			hex: Array.isArray(e) ? e[0] : null,
			t: (Array.isArray(e) && typeof e[1] === "number") ? e[1] : WKNow(),
			src: (Array.isArray(e) && e[2] === 1) ? "manual" : "auto",
		})),
		chars,
		cur: (compact.u !== null && compact.u !== undefined) ? compact.u : null,
	};
}

 
function WKParseRaw(raw) {
	if (typeof raw !== "string" || !raw) return null;
	if (raw.indexOf("WKZ1") === 0) {
		try {
			const json = WKDecompressUTF16(raw.slice(4));
			if (json === null || json === "") return null;
			return WKExpandCompact(JSON.parse(json));
		} catch (e) { WKErr("解压存储失败", e); return null; }
	}
	if (raw.indexOf("WKJ1") === 0) {
		try { return WKExpandCompact(JSON.parse(raw.slice(4))); } catch (e) { return null; }
	}
	try {
		const s = JSON.parse(raw);
		if (s && typeof s === "object") return s;
	} catch (e) { }
	return null;
}

 

function WKIsPlayerLike(C) {
	if (!C || typeof C !== "object") return false;
	if (typeof C.IsPlayer === "function" && C.IsPlayer()) return true;
	if (typeof C.IsOnline === "function" && C.IsOnline()) return true;
	return C.Type === "player" || C.Type === "online";
}

function WKCurrentNum() {
	if (typeof Player !== "undefined" && Player && Number.isInteger(Player.MemberNumber)) return Player.MemberNumber;
	return null;
}

function WKWardrobeOpen() {
	try { return typeof CurrentScreen !== "undefined" && CurrentScreen === "Appearance"; } catch (e) { return false; }
}

 
function WKEditTargetChar() {
	if (WKWardrobeOpen()) {
		try {
			if (typeof CharacterAppearanceSelection !== "undefined" && WKIsPlayerLike(CharacterAppearanceSelection)) {
				return CharacterAppearanceSelection;
			}
		} catch (e) { }
	}
	if (typeof Player !== "undefined" && Player && WKIsPlayerLike(Player)) return Player;
	return null;
}

function WKCharObjectOf(num) {
	if (typeof Player !== "undefined" && Player && Player.MemberNumber === num) return Player;
	if (typeof Character !== "undefined" && Array.isArray(Character)) {
		for (let i = 0; i < Character.length; i++) {
			const c = Character[i];
			if (c && c.MemberNumber === num) return c;
		}
	}
	return null;
}

 
function WKAppearanceBundleOf(C) {
	if (!C || !Array.isArray(C.Appearance)) return null;
	try {
		if (typeof ServerAppearanceBundle === "function") {
			const b = ServerAppearanceBundle(C.Appearance);
			return Array.isArray(b) ? WKSanitizeBundle(b) : [];
		}
	} catch (e) { WKErr("ServerAppearanceBundle 失败", e); }
	try {
		if (typeof ServerBundledItemFromAppearanceItem === "function") {
			return WKSanitizeBundle(C.Appearance.map(it => WKDeepClone(ServerBundledItemFromAppearanceItem(it))));
		}
	} catch (e) { WKErr("逐项打包失败", e); }
	return null;
}

 
const WKVolatilePropKeys = new Set([
	"WornTime", "LastOrgasmTime", "TimeSinceLastOrgasm",
	"RuinedOrgasmCount", "ResistedOrgasmCount",
]);
const WKVolatilePropPatterns = [
	new RegExp("OrgasmCount$"),
	new RegExp("^Luzi_"),
	new RegExp("^LuziCid$"),
];
const WKVolatileKeepKeys = new Set([
	"Luzi_CheekRetractor", "Luzi_NoseHook", "Luzi_TailStraps_0",
	"Luzi_HairAccessory3_1", "Luzi_HairAccessory3_2", "Luzi_Jewelry_0",
	"Luzi_ShockHardcore",
]);
const WKExtraVolatileKeys = new Set();

function WKIsVolatileKey(key) {
	if (WKExtraVolatileKeys.has(key)) return true;
	if (WKVolatileKeepKeys.has(key)) return false;
	if (WKVolatilePropKeys.has(key)) return true;
	for (let i = 0; i < WKVolatilePropPatterns.length; i++) {
		if (WKVolatilePropPatterns[i].test(key)) return true;
	}
	return false;
}

function WKIsVolatileValue(v) {
	return typeof v === "number" && v > 1e12;
}

function WKSanitizeBundle(appearance) {
	if (!Array.isArray(appearance)) return appearance;
	const out = WKDeepClone(appearance);
	for (const item of out) {
		if (!item || typeof item !== "object" || !item.Property || typeof item.Property !== "object") continue;
		const p = {};
		for (const k of Object.keys(item.Property)) {
			if (WKIsVolatileKey(k) || WKIsVolatileValue(item.Property[k])) continue;
			p[k] = item.Property[k];
		}
		item.Property = Object.keys(p).length > 0 ? p : undefined;
	}
	return out;
}

function WKHashOf(appearance) {
	const out = [];
	for (const item of (appearance || [])) {
		if (!item || typeof item !== "object") continue;
		const o = { Group: item.Group, Name: item.Name };
		if (item.Craft !== undefined) o.Craft = item.Craft;
		if (item.Color !== undefined) o.Color = item.Color;
		out.push(o);
	}
	return JSON.stringify(out);
}

function WKVolatileSnapshotOf(C) {
	const map = new Map();
	if (!C || !Array.isArray(C.Appearance)) return map;
	for (const it of C.Appearance) {
		if (!it || !it.Asset || !it.Asset.Group || !it.Property || typeof it.Property !== "object") continue;
		const vals = {};
		for (const k of Object.keys(it.Property)) {
			if (WKIsVolatileKey(k) || WKIsVolatileValue(it.Property[k])) vals[k] = WKDeepClone(it.Property[k]);
		}
		if (Object.keys(vals).length) map.set(it.Asset.Group.Name, { assetName: it.Asset.Name, vals });
	}
	return map;
}

function WKRestoreVolatileKeys(C, backup) {
	if (!C || !Array.isArray(C.Appearance) || !backup || !backup.size) return;
	for (const it of C.Appearance) {
		if (!it || !it.Asset || !it.Asset.Group) continue;
		const rec = backup.get(it.Asset.Group.Name);
		if (!rec || !rec.vals || rec.assetName !== it.Asset.Name) continue;
		if (!it.Property || typeof it.Property !== "object") it.Property = {};
		for (const k of Object.keys(rec.vals)) it.Property[k] = rec.vals[k];
	}
}

function WKItemDisplayName(group, name) {
	try {
		if (typeof AssetGet === "function" && typeof group === "string" && typeof name === "string") {
			const a = AssetGet("Female3DCG", group, name);
			if (a && typeof a.Description === "string" && a.Description && a.Description.indexOf("MISSING") !== 0) {
				return a.Description;
			}
		}
	} catch (e) { }
	return name;
}

function WKGroupDisplayName(group) {
	try {
		if (typeof AssetGroupGet === "function" && typeof group === "string") {
			const g = AssetGroupGet("Female3DCG", group);
			if (g && typeof g.Description === "string" && g.Description && g.Description.indexOf("MISSING") !== 0) {
				return g.Description;
			}
		}
	} catch (e) { }
	return group;
}

function WKGameCharDisplayName(C) {
	try {
		if (!C) return "";
		if (typeof C.Nickname === "string" && C.Nickname) return C.Nickname;
		if (typeof C.Name === "string" && C.Name) return C.Name;
		if (Number.isInteger(C.MemberNumber)) return "#" + C.MemberNumber;
	} catch (e) { }
	return "";
}

 
function WKInChatRoom() {
	try { return typeof ServerPlayerIsInChatRoom === "function" && ServerPlayerIsInChatRoom(); } catch (e) { return false; }
}

 
function WKRelinkItemColor(C) {
	try {
		if (typeof ItemColorState === "undefined" || !ItemColorState) return;
		if (typeof ItemColorItem === "undefined" || !ItemColorItem) return;
		if (typeof ItemColorCharacter === "undefined" || !ItemColorCharacter || ItemColorCharacter !== C) return;
		const groupName = (ItemColorItem.Asset && ItemColorItem.Asset.Group) ? ItemColorItem.Asset.Group.Name : null;
		if (!groupName) return;
		const fresh = (typeof InventoryGet === "function") ? InventoryGet(C, groupName) : null;
		if (!fresh) {
			 
			try { if (typeof ItemColorFireExit === "function") ItemColorFireExit(false); } catch (e) { }
			return;
		}
		if (fresh === ItemColorItem) return;
		

 
		const oldAsset = ItemColorItem.Asset;
		const newAsset = fresh.Asset;
		if (oldAsset && newAsset && (oldAsset.Name !== newAsset.Name)) {
			try { if (typeof ItemColorFireExit === "function") ItemColorFireExit(false); } catch (e) { }
			return;
		}
		ItemColorItem = fresh;
		 
		if (Array.isArray(ItemColorState.colors)) {
			for (let i = 0; i < ItemColorState.colors.length; i++) {
				ItemColorState.colors[i] = (Array.isArray(fresh.Color) && i < fresh.Color.length)
					? fresh.Color[i]
					: (fresh.Asset && Array.isArray(fresh.Asset.DefaultColor) ? fresh.Asset.DefaultColor[i] : undefined);
			}
		}
		 
		if (Array.isArray(ItemColorState.opacity) && fresh.Property && Array.isArray(fresh.Property.Opacity)) {
			for (let i = 0; i < ItemColorState.opacity.length && i < fresh.Property.Opacity.length; i++) {
				ItemColorState.opacity[i] = fresh.Property.Opacity[i];
			}
		}
	} catch (e) { WKErr("选色器状态重链接失败", e); }
}

 
function WKApplyEntry(C, entry) {
	if (!C || !entry || typeof entry !== "object") return { ok: false };
	const num = C.MemberNumber;
	const family = (typeof C.AssetFamily === "string" && C.AssetFamily) ? C.AssetFamily : "Female3DCG";
	const volatileBackup = WKVolatileSnapshotOf(C);
	let ok = true;

	WKState.suppress = true;
	try {
		try {
			if (typeof ServerAppearanceLoadFromBundle === "function") {
				ok = ServerAppearanceLoadFromBundle(C, family, entry.appearance || [], num) !== false;
			} else {
				C.Appearance = WKDeepClone(entry.appearance || []);
			}
		} catch (e) { WKErr("应用外观失败", e); ok = false; }

		WKRestoreVolatileKeys(C, volatileBackup);

		 
		WKRelinkItemColor(C);

		try { if (typeof CharacterRefresh === "function") CharacterRefresh(C, true); } catch (e) { WKErr("CharacterRefresh 失败", e); }
		try {
			if (typeof ChatRoomCharacterUpdate === "function" && WKInChatRoom()) ChatRoomCharacterUpdate(C);
		} catch (e) { WKErr("聊天室同步失败", e); }
	} finally {
		WKState.suppress = false;
		
 
		WKState.applyCooldownUntil = WKNow() + 1500;
	}

	 
	if (WKState.itemWatch) {
		try {
			const a = WKAppearanceBundleOf(C);
			WKState.itemWatchHash = a === null ? null : WKHashOf(a);
			WKState.itemWatchCaptured = WKState.itemWatchHash;
			WKState.itemWatchStable = true;
			const item = (typeof ItemColorItem !== "undefined") ? ItemColorItem : null;
			WKState.itemWatchColors = (item && Array.isArray(item.Color)) ? item.Color.slice() : null;
		} catch (e) { }
	}

	return { ok, num };
}

 

 
function WKPaletteAdd(hex, src) {
	const h = WKHexOf(hex);
	if (!h) return { added: false, hex: null };
	const s = WKStore.load();
	const found = s.palette.find(e => e.hex === h);
	if (found) {
		found.t = WKNow();
		WKStore.requestSave();
		WKUI.dirty = true;
		return { added: false, hex: h };
	}
	s.palette.unshift({ hex: h, t: WKNow(), src: src === "manual" ? "manual" : "auto" });
	if (s.palette.length > s.settings.paletteMax) s.palette = s.palette.slice(0, s.settings.paletteMax);
	WKStore.requestSave();
	WKUI.dirty = true;
	return { added: true, hex: h };
}

function WKPaletteRemove(hex) {
	const h = WKHexOf(hex);
	if (!h) return false;
	const s = WKStore.load();
	const before = s.palette.length;
	s.palette = s.palette.filter(e => e.hex !== h);
	if (s.palette.length !== before) {
		WKStore.requestSave();
		WKUI.dirty = true;
		return true;
	}
	return false;
}

function WKPaletteClear() {
	const s = WKStore.load();
	if (!s.palette.length) return 0;
	const n = s.palette.length;
	s.palette = [];
	WKStore.requestSave();
	WKUI.dirty = true;
	return n;
}

function WKPaletteList() {
	return WKStore.load().palette.slice();
}

 
function WKCurrentColorValues() {
	const out = [];
	try {
		if (typeof ItemColorItem !== "undefined" && ItemColorItem && Array.isArray(ItemColorItem.Color)) {
			for (const c of ItemColorItem.Color) {
				const h = WKHexOf(c);
				if (h && out.indexOf(h) < 0) out.push(h);
			}
		}
	} catch (e) { }
	if (out.length === 0) {
		const C = WKEditTargetChar();
		const group = C ? WKFocusGroupOf(C) : null;
		if (C && group && typeof InventoryGet === "function") {
			try {
				const item = InventoryGet(C, group);
				if (item && Array.isArray(item.Color)) {
					for (const c of item.Color) {
						const h = WKHexOf(c);
						if (h && out.indexOf(h) < 0) out.push(h);
					}
				}
			} catch (e) { }
		}
	}
	return out;
}

 
function WKRecordCurrentColors() {
	const vals = WKCurrentColorValues();
	if (!vals.length) {
		WKToast(WKT("toastRecordedNone"));
		return { added: 0 };
	}
	let added = 0;
	for (const h of vals) if (WKPaletteAdd(h, "manual").added) added++;
	if (added > 0) WKToast(WKT("toastRecorded", added));
	else WKToast(WKT("toastRecordedExists"));
	WKUIRenderAll();
	return { added };
}

 
function WKPaletteAutoRecord(values) {
	if (!Array.isArray(values)) return;
	for (const v of values) WKPaletteAdd(v, "auto");
}

 
function WKFocusGroupOf(C) {
	try {
		if (typeof DialogFocusItem !== "undefined" && DialogFocusItem && DialogFocusItem.Asset && DialogFocusItem.Asset.Group) {
			return DialogFocusItem.Asset.Group.Name;
		}
	} catch (e) { }
	try {
		if (C && C.FocusGroup && C.FocusGroup.Name) return C.FocusGroup.Name;
	} catch (e) { }
	return null;
}

 

 
function WKFillInPicker(hex) {
	if (!(typeof ItemColorState !== "undefined" && ItemColorState) ||
		!(typeof ItemColorItem !== "undefined" && ItemColorItem)) return null;
	const C = (typeof ItemColorCharacter !== "undefined" && ItemColorCharacter) ? ItemColorCharacter : WKEditTargetChar();
	const group = (ItemColorItem.Asset && ItemColorItem.Asset.Group) ? ItemColorItem.Asset.Group.Name : null;
	if (!C || !group) return null;

	const indices = (typeof ItemColorPickerIndices !== "undefined" && Array.isArray(ItemColorPickerIndices) && ItemColorPickerIndices.length)
		? ItemColorPickerIndices
		: null;
	if (!indices) { WKToast(WKT("toastNeedPicker")); return { ok: false, group }; }

	let count = 0;
	for (const i of indices) {
		if (Array.isArray(ItemColorState.colors)) ItemColorState.colors[i] = hex;
		if (Array.isArray(ItemColorItem.Color) && i < ItemColorItem.Color.length) ItemColorItem.Color[i] = hex;
		count++;
	}
	try { if (typeof CharacterLoadCanvas === "function") CharacterLoadCanvas(C); } catch (e) { }
	 
	WKCaptureStep(C, {
		label: WKItemLayerLabel(indices) + " · " + WKT("stepFillLayers", hex),
		chip: hex,
		explicit: true,
	});
	WKToast(WKT("toastFilledLayers", hex));
	return { ok: true, group, count };
}

 
function WKFillColor(hex, opts) {
	const h = WKHexOf(hex);
	if (!h) { WKToast(WKT("toastBadColor")); return { ok: false }; }

	 
	try {
		if (typeof ItemColorState !== "undefined" && ItemColorState && typeof ItemColorItem !== "undefined" && ItemColorItem) {
			const r = WKFillInPicker(h);
			if (r) return r;
		}
	} catch (e) { WKErr("选色器填色失败", e); }

	WKToast(WKT("toastNeedPicker"));
	return { ok: false };
}

 
function WKSwatchAction(hex, ev) {
	const h = WKHexOf(hex);
	if (!h) { WKToast(WKT("toastBadColor")); return { ok: false }; }
	if (ev && (ev.ctrlKey || ev.metaKey)) {
		WKPreviewBgApply(h);
		WKToast(WKT("toastBgSet", h));
		return { ok: true, bg: true };
	}
	const r = WKFillColor(h, {});
	return r;
}

 

const WKState = {
	suppress: false,         
	pendingLabel: null,      
	captureTimers: new Map(),
	itemWatch: null,         
	itemWatchHash: null,
	itemWatchStable: false,
	itemWatchCaptured: null,
	itemWatchColors: null,   
	applyCooldownUntil: 0,   
	previewTimer: null,      
	previewTick: 0,
	shield: false,           
};

function WKSetPending(label, chip) {
	WKState.pendingLabel = { text: label, chip: chip || null, t: WKNow() };
}

function WKTakePending() {
	const p = WKState.pendingLabel;
	WKState.pendingLabel = null;
	if (p && WKNow() - p.t < 2500) return p;
	return null;
}

function WKCharOf(num) {
	return WKStore.load().chars[String(num)] || null;
}

function WKCharEnsure(num, name, nick) {
	const s = WKStore.load();
	const key = String(num);
	if (!s.chars[key]) {
		s.chars[key] = { num, name: typeof name === "string" ? name : "", nick: typeof nick === "string" ? nick : "", history: [], cursor: 0 };
	} else {
		const c = s.chars[key];
		if (typeof name === "string" && name) c.name = name;
		if (typeof nick === "string" && nick) c.nick = nick;
	}
	return s.chars[key];
}

function WKTrimHistory(c, keep) {
	if (!Array.isArray(c.history)) { c.history = []; c.cursor = 0; return; }
	if (c.history.length > keep) {
		const removed = c.history.length - keep;
		c.history = c.history.slice(removed);
		c.cursor = Math.max(0, (c.cursor | 0) - removed);
	}
}

 
function WKCaptureStep(C, opts) {
	opts = opts || {};
	if (WKState.suppress) return null;
	if (!WKTabVisible()) return null;
	if (!C || !WKIsPlayerLike(C)) return null;
	const num = C.MemberNumber;
	if (!Number.isInteger(num) || num < 0) return null;

	const cur = WKCurrentNum();
	if (cur !== null) WKStore.ensureAccount(cur);

	const appearance = WKAppearanceBundleOf(C);
	if (appearance === null) return null;
	const hash = WKHashOf(appearance);

	const char = WKCharEnsure(num,
		typeof C.Name === "string" ? C.Name : "",
		typeof C.Nickname === "string" ? C.Nickname : "");

	 
	const at = char.history[char.cursor];
	if (at && at.hash === hash) {
		char.last = WKNow();
		return null;
	}

	 
	const inCooldown = WKNow() < WKState.applyCooldownUntil;
	if (inCooldown && !opts.explicit) return null;

	 
	if (!opts.explicit) {
		for (let i = 0; i < char.history.length; i++) {
			if (char.history[i].hash === hash) {
				if (i !== char.cursor) {
					char.cursor = i;
					char.last = WKNow();
					WKStore.load().cur = num;
					WKStore.requestSave();
					WKUI.dirty = true;
					if (WKUI.open) {
						try { WKUIRenderAll(); } catch (e) { WKErr("历史渲染失败", e); }
					}
				}
				return char.history[i];
			}
		}
	}

	const p = WKTakePending();
	const entry = {
		t: WKNow(),
		label: opts.label || (p && p.text) || (char.history.length === 0 ? WKT("stepInit") : WKT("stepAdjust")),
		chip: (opts.chip !== undefined) ? opts.chip : ((p && p.chip) || null),
		hash,
		appearance,
	};

	 
	char.history.push(entry);
	char.cursor = char.history.length - 1;
	WKTrimHistory(char, WKStore.load().settings.historyKeep);
	char.last = entry.t;
	WKStore.load().cur = num;
	WKStore.requestSave();
	WKUI.dirty = true;
	 
	if (WKUI.open) {
		try { WKUIRenderAll(); } catch (e) { WKErr("历史渲染失败", e); }
	}
	 
	try { WKPreviewSetLive(); } catch (e) { }
	return entry;
}

 
function WKQueueCapture(C, opts) {
	if (WKState.suppress) return;
	if (!C || typeof C !== "object") return;
	const num = C.MemberNumber;
	if (!Number.isInteger(num) || num < 0) return;
	 
	const target = WKEditTargetChar();
	if (!target || target.MemberNumber !== num) return;
	const old = WKState.captureTimers.get(num);
	if (old) clearTimeout(old);
	WKState.captureTimers.set(num, setTimeout(() => {
		WKState.captureTimers.delete(num);
		try { WKCaptureStep(C, opts); } catch (e) { WKErr("采集失败", e); }
	}, 700));
}

 
function WKUndo() {
	const C = WKEditTargetChar();
	if (!C) { WKToast(WKT("toastNoTarget")); return { ok: false }; }
	const char = WKCharOf(C.MemberNumber);
	if (!char || char.cursor <= 0) { WKToast(WKT("toastNothingToUndo")); return { ok: false }; }
	char.cursor--;
	const entry = char.history[char.cursor];
	const res = WKApplyEntry(C, entry);
	if (res.ok) {
		WKStore.requestSave();
		WKUI.dirty = true;
		WKToast(WKT("toastUndone", entry.label));
	}
	return res;
}

 
function WKRedo() {
	const C = WKEditTargetChar();
	if (!C) { WKToast(WKT("toastNoTarget")); return { ok: false }; }
	const char = WKCharOf(C.MemberNumber);
	if (!char || char.cursor >= char.history.length - 1) { WKToast(WKT("toastNothingToRedo")); return { ok: false }; }
	char.cursor++;
	const entry = char.history[char.cursor];
	const res = WKApplyEntry(C, entry);
	if (res.ok) {
		WKStore.requestSave();
		WKUI.dirty = true;
		WKToast(WKT("toastRedone", entry.label));
	}
	return res;
}

 
function WKJumpTo(idx) {
	const C = WKEditTargetChar();
	if (!C) { WKToast(WKT("toastNoTarget")); return { ok: false }; }
	const char = WKCharOf(C.MemberNumber);
	if (!char || !Number.isInteger(idx) || idx < 0 || idx >= char.history.length) return { ok: false };
	if (idx === char.cursor) return { ok: true, same: true };
	char.cursor = idx;
	const entry = char.history[idx];
	const res = WKApplyEntry(C, entry);
	if (res.ok) {
		WKStore.requestSave();
		WKUI.dirty = true;
		WKToast(WKT("toastJumped", entry.label));
	}
	return res;
}

function WKClearHistory() {
	const C = WKEditTargetChar();
	if (!C) return 0;
	const char = WKCharOf(C.MemberNumber);
	if (!char || !char.history.length) return 0;
	const n = char.history.length;
	char.history = [];
	char.cursor = 0;
	WKStore.requestSave();
	WKUI.dirty = true;
	return n;
}

 
function WKTargetName() {
	const C = WKEditTargetChar();
	if (!C) {
		const s = WKStore.load();
		if (s.cur !== null && s.chars[String(s.cur)]) {
			const c = s.chars[String(s.cur)];
			return (c.nick || c.name || ("#" + c.num));
		}
		return WKT("noTarget");
	}
	const name = WKGameCharDisplayName(C);
	if (name) return name;
	return WKCurrentNum() !== null ? "#" + WKCurrentNum() : WKT("noTarget");
}

 

 
function WKColorItemName() {
	try {
		if (typeof ItemColorItem !== "undefined" && ItemColorItem && ItemColorItem.Asset) {
			const a = ItemColorItem.Asset;
			if (typeof a.Description === "string" && a.Description && a.Description.indexOf("MISSING") !== 0) return a.Description;
			if (typeof a.Name === "string" && a.Name) return a.Name;
		}
	} catch (e) { }
	return "";
}

 
function WKColorChangedIndices() {
	const out = [];
	try {
		const item = (typeof ItemColorItem !== "undefined") ? ItemColorItem : null;
		if (!item || !Array.isArray(item.Color)) return out;
		const prev = WKState.itemWatchColors;
		for (let i = 0; i < item.Color.length; i++) {
			if (!prev || !Array.isArray(prev) || i >= prev.length || String(prev[i]) !== String(item.Color[i])) out.push(i);
		}
	} catch (e) { }
	return out;
}

 
function WKGroupNameOf(cg, keyBase) {
	try {
		if (typeof ItemColorGroupNames !== "undefined" && ItemColorGroupNames && typeof ItemColorGroupNames.get === "function") {
			const n = ItemColorGroupNames.get(keyBase + cg.name);
			if (n && String(n).indexOf("MISSING") !== 0) return String(n);
		}
	} catch (e) { }
	return cg.name;
}

 
function WKLayerNameOfKey(keyBase, layerKey) {
	try {
		if (typeof ItemColorLayerNames !== "undefined" && ItemColorLayerNames && typeof ItemColorLayerNames.get === "function") {
			const n = ItemColorLayerNames.get(keyBase + layerKey);
			if (n && String(n).indexOf("MISSING") !== 0) return String(n);
		}
	} catch (e) { }
	return null;
}

 
function WKSingleLayerLabelOf(cg, keyBase) {
	const n = WKLayerNameOfKey(keyBase, cg.name);
	if (n) return n;
	return cg.name;
}

 
function WKLayerLabelOf(indices) {
	try {
		if (typeof ItemColorState === "undefined" || !ItemColorState || !Array.isArray(ItemColorState.colorGroups)) return null;
		const changed = indices || [];
		if (!changed.length) return null;
		const set = {};
		for (const i of changed) set[i] = true;
		const total = Array.isArray(ItemColorState.colors) ? ItemColorState.colors.length : 0;
		const asset = (typeof ItemColorItem !== "undefined" && ItemColorItem) ? ItemColorItem.Asset : null;
		const keyBase = (asset && typeof asset.DynamicGroupName === "string" ? asset.DynamicGroupName : "") + (asset ? asset.Name : "");

		 
		const matches = [];
		for (const cg of ItemColorState.colorGroups) {
			if (!cg || cg.name === null || cg.name === undefined) continue;
			const idxs = (cg.layers || []).map(l => l.ColorIndex).filter(i => typeof i === "number");
			const hits = idxs.filter(i => set[i]);
			if (hits.length) matches.push({ cg, idxs, hits });
		}

		 
		for (const m of matches) {
			if (m.idxs.length > 0 && m.hits.length === m.idxs.length && changed.length === m.idxs.length) {
				if (m.cg.layers.length === 1) return WKSingleLayerLabelOf(m.cg, keyBase);
				return WKGroupNameOf(m.cg, keyBase) + "/" + WKT("layerAll");
			}
		}

		 
		if (total > 0 && changed.length >= total) return WKT("wholeItem");

		 
		if (matches.length) {
			const m = matches[0];
			if ((m.cg.layers || []).length === 1) return WKSingleLayerLabelOf(m.cg, keyBase);
			const hitLayers = (m.cg.layers || []).filter(l => set[l.ColorIndex]);
			if (hitLayers.length === 1 && hitLayers[0].Name) {
				const layerName = WKLayerNameOfKey(keyBase, hitLayers[0].Name) || hitLayers[0].Name;
				return WKGroupNameOf(m.cg, keyBase) + "/" + layerName;
			}
			return WKGroupNameOf(m.cg, keyBase);
		}

		 
		return WKT("wholeItem");
	} catch (e) { }
	return null;
}

 
function WKItemLayerLabel(indices) {
	const itemName = WKColorItemName();
	const layer = WKLayerLabelOf(indices);
	if (itemName && layer) return itemName + "/" + layer;
	if (itemName) return itemName;
	if (layer) return layer;
	return WKT("stepColorEdit");
}

function WKItemWatchTick() {
	try {
		const C = WKEditTargetChar();
		if (!C) return;
		if (WKState.suppress) return;
		const appearance = WKAppearanceBundleOf(C);
		if (appearance === null) return;
		const hash = WKHashOf(appearance);
		if (hash === WKState.itemWatchHash) {
			if (!WKState.itemWatchStable && hash !== WKState.itemWatchCaptured) {
				WKState.itemWatchStable = true;
				WKState.itemWatchCaptured = hash;
				 
				const changed = WKColorChangedIndices();
				WKCaptureStep(C, { label: WKItemLayerLabel(changed), explicit: true });
				try {
					const item = (typeof ItemColorItem !== "undefined") ? ItemColorItem : null;
					WKState.itemWatchColors = (item && Array.isArray(item.Color)) ? item.Color.slice() : WKState.itemWatchColors;
				} catch (e) { }
			} else {
				WKState.itemWatchStable = true;
			}
		} else {
			WKState.itemWatchHash = hash;
			WKState.itemWatchStable = false;
		}
	} catch (e) { WKErr("选色器轮询失败", e); }
}

 
function WKItemWatchStart(item) {
	if (WKState.itemWatch) return;
	const C = WKEditTargetChar();
	try {
		const appearance = C ? WKAppearanceBundleOf(C) : null;
		WKState.itemWatchHash = appearance === null ? null : WKHashOf(appearance);
	} catch (e) { WKState.itemWatchHash = null; }
	WKState.itemWatchCaptured = WKState.itemWatchHash;
	WKState.itemWatchStable = true;
	try {
		const src = item || ((typeof ItemColorItem !== "undefined") ? ItemColorItem : null);
		WKState.itemWatchColors = (src && Array.isArray(src.Color)) ? src.Color.slice() : null;
	} catch (e) { WKState.itemWatchColors = null; }
	try {
		WKState.itemWatch = setInterval(WKItemWatchTick, 600);
	} catch (e) { WKErr("选色器轮询启动失败", e); }
}

 
function WKItemWatchRebaseline(item) {
	try {
		const src = item || ((typeof ItemColorItem !== "undefined") ? ItemColorItem : null);
		if (src && Array.isArray(src.Color)) WKState.itemWatchColors = src.Color.slice();
		const C = WKEditTargetChar();
		const a = C ? WKAppearanceBundleOf(C) : null;
		if (a !== null) {
			WKState.itemWatchHash = WKHashOf(a);
			WKState.itemWatchCaptured = WKState.itemWatchHash;
			WKState.itemWatchStable = true;
		}
	} catch (e) { }
}

function WKItemWatchStop() {
	if (WKState.itemWatch) {
		try { clearInterval(WKState.itemWatch); } catch (e) { }
		WKState.itemWatch = null;
		WKState.itemWatchHash = null;
		WKState.itemWatchStable = false;
		WKState.itemWatchCaptured = null;
		WKState.itemWatchColors = null;
	}
}

 

function WardrobeKitToggle() {
	if (WKUI.open) WardrobeKitClose(); else WardrobeKitOpen();
}

function WKInputClear(input) {
	if (!input) return;
	input.value = "";
	try { input.dispatchEvent(new InputEvent("input")); } catch (e) { }
}

function WKInstallHooks(mod) {
	const safe = (fn) => (...args) => {
		try { return fn(...args); } catch (e) { WKErr(e); }
	};

	 
	try {
		mod.hookFunction("CharacterRefresh", 10, (args, next) => {
			const res = next(args);
			safe(() => WKQueueCapture(args[0], {}))();
			return res;
		});
	} catch (e) { WKErr("hook CharacterRefresh 失败", e); }

	 
	try {
		mod.hookFunction("CharacterAppearanceSetItem", 10, (args, next) => {
			safe(() => {
				const C = args[0];
				const Group = args[1];
				const ItemAsset = args[2];
				const name = ItemAsset ? WKItemDisplayName(Group, ItemAsset.Name) : WKGroupDisplayName(Group);
				WKSetPending(WKT("stepItem", WKGroupDisplayName(Group) + (name ? " · " + name : "")));
			})();
			const res = next(args);
			safe(() => { WKCaptureStep(args[0], { explicit: true }); })();
			return res;
		});
	} catch (e) { WKErr("hook CharacterAppearanceSetItem 失败", e); }

	 
	try {
		mod.hookFunction("CharacterAppearanceNextColor", 10, (args, next) => {
			safe(() => {
				const C = args[0];
				const Group = args[1];
				WKSetPending(WKT("stepColorCycle", WKGroupDisplayName(Group)));
			})();
			const res = next(args);
			safe(() => {
				WKCaptureStep(args[0], { explicit: true });
				try {
					if (typeof InventoryGet === "function") {
						const item = InventoryGet(args[0], args[1]);
						if (item && Array.isArray(item.Color)) WKPaletteAutoRecord(item.Color);
					}
				} catch (e) { }
			})();
			return res;
		});
	} catch (e) { WKErr("hook CharacterAppearanceNextColor 失败", e); }

	 
	try {
		mod.hookFunction("CharacterAppearanceSetColorForGroup", 10, (args, next) => {
			safe(() => {
				const C = args[0];
				const Color = args[1];
				const Group = args[2];
				const h = WKHexOf(Color);
				WKSetPending(WKT("stepColorSet", WKGroupDisplayName(Group), h || String(Color)), h);
			})();
			const res = next(args);
			safe(() => {
				WKCaptureStep(args[0], { explicit: true });
				const h = WKHexOf(args[1]);
				if (h) WKPaletteAutoRecord([h]);
			})();
			return res;
		});
	} catch (e) { WKErr("hook CharacterAppearanceSetColorForGroup 失败", e); }

	

 
	try {
		mod.hookFunction("ItemColorLoad", 10, (args, next) => {
			safe(() => WKItemWatchStart(args[1]))();
			const res = next(args);
			safe(() => WKItemWatchRebaseline(args[1]))();
			return res;
		});
	} catch (e) { WKErr("hook ItemColorLoad 失败", e); }

	 
	try {
		mod.hookFunction("ItemColorFireExit", 10, (args, next) => {
			const res = next(args);
			safe(() => WKItemWatchStop())();
			return res;
		});
	} catch (e) { WKErr("hook ItemColorFireExit 失败", e); }

	 
	try {
		mod.hookFunction("ItemColorSaveAndExit", 10, (args, next) => {
			const itemName = WKColorItemName();
			const res = next(args);
			safe(() => {
				try {
					if (typeof ItemColorItem !== "undefined" && ItemColorItem && Array.isArray(ItemColorItem.Color)) {
						WKPaletteAutoRecord(ItemColorItem.Color);
					}
				} catch (e) { }
				const label = itemName ? (itemName + " · " + WKT("stepColorSave")) : WKT("stepColorSave");
				WKSetPending(label);
				const C = WKEditTargetChar();
				if (C) WKCaptureStep(C, { label, explicit: true });
			})();
			return res;
		});
	} catch (e) { WKErr("hook ItemColorSaveAndExit 失败", e); }

	 
	try {
		mod.hookFunction("ItemColorCancelAndExit", 10, (args, next) => {
			const itemName = WKColorItemName();
			const res = next(args);
			safe(() => {
				const label = itemName ? (itemName + " · " + WKT("stepColorCancel")) : WKT("stepColorCancel");
				WKSetPending(label);
				const C = WKEditTargetChar();
				if (C) WKCaptureStep(C, { label, explicit: true });
			})();
			return res;
		});
	} catch (e) { WKErr("hook ItemColorCancelAndExit 失败", e); }

	 
	try {
		mod.hookFunction("ItemColorExitClick", 10, (args, next) => {
			const itemName = WKColorItemName();
			const res = next(args);
			safe(() => {
				const label = itemName ? (itemName + " · " + WKT("stepColorCancel")) : WKT("stepColorCancel");
				WKSetPending(label);
				const C = WKEditTargetChar();
				if (C) WKCaptureStep(C, { label, explicit: true });
			})();
			return res;
		});
	} catch (e) { WKErr("hook ItemColorExitClick 失败", e); }

	 
	try {
		mod.hookFunction("CharacterAppearanceWardrobeLoad", 10, (args, next) => {
			safe(() => { WKSetPending(WKT("stepLoad")); })();
			const res = next(args);
			safe(() => { WKCaptureStep(args[0], { label: WKT("stepLoad"), explicit: true }); })();
			return res;
		});
	} catch (e) { WKErr("hook CharacterAppearanceWardrobeLoad 失败", e); }

	try {
		mod.hookFunction("CharacterAppearanceLoadCharacter", 10, (args, next) => {
			safe(() => { WKSetPending(WKT("stepLoad")); })();
			const res = next(args);
			safe(() => { WKCaptureStep(args[0], { label: WKT("stepLoad"), explicit: true }); })();
			return res;
		});
	} catch (e) { WKErr("hook CharacterAppearanceLoadCharacter 失败", e); }

	 
	try {
		mod.hookFunction("ChatRoomCharacterItemUpdate", 10, (args, next) => {
			const res = next(args);
			safe(() => {
				const C = args[0];
				if (C && Number.isInteger(C.MemberNumber) && WKCurrentNum() !== null && C.MemberNumber === WKCurrentNum()) {
					WKSetPending(WKT("stepRoom"));
					WKQueueCapture(C, { label: WKT("stepRoom") });
				}
			})();
			return res;
		});
	} catch (e) { WKErr("hook ChatRoomCharacterItemUpdate 失败", e); }

	try {
		mod.hookFunction("ChatRoomCharacterUpdate", 10, (args, next) => {
			const res = next(args);
			safe(() => {
				const C = args[0];
				if (C && Number.isInteger(C.MemberNumber) && WKCurrentNum() !== null && C.MemberNumber === WKCurrentNum()) {
					WKSetPending(WKT("stepRoom"));
					WKQueueCapture(C, { label: WKT("stepRoom") });
				}
			})();
			return res;
		});
	} catch (e) { WKErr("hook ChatRoomCharacterUpdate 失败", e); }

	 
	try {
		mod.hookFunction("ChatRoomSendChat", 10, (args, next) => {
			const input = document.getElementById("InputChat");
			const raw = input ? input.value : "";
			const t = (raw || "").trim().toLowerCase();
			if (t === "/wk" || t === "/wardrobe" || t === "/衣柜") {
				WKInputClear(input);
				safe(WardrobeKitToggle)();
				return;
			}
			return next(args);
		});
	} catch (e) { WKErr("hook ChatRoomSendChat 失败", e); }
}

 

const WKText = {
	zh: {
		title: "WardrobeKit · 衣柜调色便捷工具",
		dotTitle: "WardrobeKit 衣柜调色便捷工具（点击开关浮窗，按住拖动）",
		noTarget: "（无目标）",
		minTitle: "最小化 / 恢复",
		closeTitle: "关闭（Esc）",
		btnUndo: "撤销",
		btnRedo: "重做",
		btnRecord: "记录当前色",
		btnPreviewNow: "预览当前",
		btnClearHistory: "清空历史",
		btnClearPalette: "清空色板",
		btnLangEn: "EN",
		btnLangZh: "中文",
		headHistory: "撤销 / 重做历史",
		headPalette: "色板",
		tipHistory: "点步骤看预览 · 「应用」跳回该步 · Ctrl+Z 撤销 / Ctrl+Y 重做",
		tipPalette: "左键点色块 = 给当前图层填色（需先打开物品的颜色页）；Ctrl+点色块 = 设为预览背景色",
		statusSteps: "步骤 {0}/{1}",
		stepInit: "初始记录",
		stepAdjust: "外观调整",
		stepItem: "换装：{0}",
		stepColorCycle: "轮换颜色：{0}",
		stepColorSet: "整件填色：{0} {1}",
		stepColorEdit: "颜色编辑",
		stepColorSave: "颜色编辑完成",
		stepColorCancel: "颜色取消还原",
		stepFillLayers: "填色 {0}",
		wholeItem: "整件",
		layerAll: "所有",
		stepRoom: "聊天室变更",
		stepLoad: "整身替换",
		toastNoTarget: "没有可编辑的目标（先登录 / 打开衣柜）",
		toastNothingToUndo: "没有可撤销的步骤",
		toastNothingToRedo: "没有可重做的步骤",
		toastUndone: "已撤销：{0}",
		toastRedone: "已重做：{0}",
		toastJumped: "已跳到：{0}",
		toastBadColor: "色号格式不对（例：#FF3366）",
		toastNoFocus: "没有聚焦的部位：先在衣柜选中一个部位，或聊天室点开某件物品",
		toastNeedPicker: "请先打开物品的颜色页（选色器）并选中要改的图层，再点色块填色",
		toastFilledLayers: "已给当前图层填色 {0}",
		toastBgSet: "预览背景色已设为 {0}",
		toastColorAdded: "已记录色号 {0}",
		toastRecorded: "已记录 {0} 个色号",
		toastRecordedNone: "当前没有可记录的色号（先改一次颜色，或选中带颜色的物品）",
		toastRecordedExists: "这些色号都已在色板里",
		toastColorRemoved: "已删除色号 {0}",
		toastPaletteCleared: "色板已清空（{0} 个）",
		toastHistoryCleared: "历史已清空（{0} 步）",
		apply: "应用",
		preview: "预览",
		curBadge: "当前位置",
		remove: "✕",
		confirmRemove: "确认删除",
		addPh: "色号 如 FF3366",
		btnAdd: "添加",
		armClearHistory: "点击确认清空",
		armClearPalette: "点击确认清空",
		previewTitle: "预览",
		previewNowTitle: "当前 · {0}",
		liveBadge: "实时",
		previewZoomHint: "滚轮缩放（0.1x-8x）· 放大后按住拖拽平移 · ✕ 关闭",
		previewPose: "姿势",
		poseFollow: "跟随当前",
		previewBg: "背景",
		historyEmpty: "还没有历史记录。改一改颜色 / 换装，就会自动记下来。",
		paletteEmpty: "点「记录当前色」记录色号，也可以在下方输入色号手动添加",
	},
	en: {
		title: "WardrobeKit · Wardrobe Color Tools",
		dotTitle: "WardrobeKit (click to toggle, drag to move)",
		noTarget: "(no target)",
		minTitle: "Minimize / Restore",
		closeTitle: "Close (Esc)",
		btnUndo: "Undo",
		btnRedo: "Redo",
		btnRecord: "Record Color",
		btnPreviewNow: "Preview Now",
		btnClearHistory: "Clear History",
		btnClearPalette: "Clear Palette",
		btnLangEn: "EN",
		btnLangZh: "中文",
		headHistory: "Undo / Redo History",
		headPalette: "Palette",
		tipHistory: "Click a step to preview · Apply to jump back · Ctrl+Z undo / Ctrl+Y redo",
		tipPalette: "Click = fill the current layer (open an item's color page first); Ctrl+click = set preview background",
		statusSteps: "Step {0}/{1}",
		stepInit: "Initial state",
		stepAdjust: "Appearance change",
		stepItem: "Item change: {0}",
		stepColorCycle: "Color cycle: {0}",
		stepColorSet: "Whole-item fill: {0} {1}",
		stepColorEdit: "Color edit",
		stepColorSave: "Color edit saved",
		stepColorCancel: "Color edit cancelled",
		stepFillLayers: "fill {0}",
		wholeItem: "Whole item",
		layerAll: "All",
		stepRoom: "Chat room change",
		stepLoad: "Outfit replaced",
		toastNoTarget: "No editable target (log in / open the wardrobe first)",
		toastNothingToUndo: "Nothing to undo",
		toastNothingToRedo: "Nothing to redo",
		toastUndone: "Undone: {0}",
		toastRedone: "Redone: {0}",
		toastJumped: "Jumped to: {0}",
		toastBadColor: "Bad color format (e.g. #FF3366)",
		toastNoFocus: "No focused item: select a slot in the wardrobe, or open an item in the chat dialog",
		toastNeedPicker: "Open an item's color page (picker) and select a layer first, then click a swatch",
		toastFilledLayers: "Filled current layers with {0}",
		toastBgSet: "Preview background set to {0}",
		toastColorAdded: "Color recorded: {0}",
		toastRecorded: "Recorded {0} colors",
		toastRecordedNone: "Nothing to record (change a color first, or select a colored item)",
		toastRecordedExists: "Those colors are already in the palette",
		toastColorRemoved: "Removed {0}",
		toastPaletteCleared: "Palette cleared ({0})",
		toastHistoryCleared: "History cleared ({0} steps)",
		apply: "Apply",
		preview: "Preview",
		curBadge: "CURRENT",
		remove: "✕",
		confirmRemove: "Confirm",
		addPh: "hex e.g. FF3366",
		btnAdd: "Add",
		armClearHistory: "Click again to clear",
		armClearPalette: "Click again to clear",
		previewTitle: "Preview",
		previewNowTitle: "Now · {0}",
		liveBadge: "LIVE",
		previewZoomHint: "Scroll to zoom (0.1x-8x), drag to pan when zoomed, ✕ to close",
		previewPose: "Pose",
		poseFollow: "Follow",
		previewBg: "BG",
		historyEmpty: "No history yet. Change colors or clothes and steps appear here.",
		paletteEmpty: "Click Record Color to record colors, or type a hex below",
	},
};

function WKT(key, ...args) {
	const d = WKText[WKUI.lang] || WKText.zh;
	let s = (d && d[key]) || (WKText.zh[key]) || key;
	for (let i = 0; i < args.length; i++) s = s.split("{" + i + "}").join(String(args[i]));
	return s;
}

function WKTimeStr(t) {
	const d = new Date(t);
	const p = (n) => (n < 10 ? "0" + n : "" + n);
	const sameDay = (new Date()).toDateString() === d.toDateString();
	if (sameDay) return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
	return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}

 

 
function WKPoseEntries() {
	const list = [];
	try {
		if (typeof Pose !== "undefined" && Array.isArray(Pose)) {
			for (const p of Pose) {
				if (p && typeof p.Name === "string" && p.Name) {
					list.push({
						name: p.Name,
						label: (typeof p.Description === "string" && p.Description && p.Description.indexOf("MISSING") !== 0)
							? p.Description : p.Name,
					});
				}
			}
		}
	} catch (e) { }
	if (!list.length) {
		try {
			if (typeof PoseRecord === "object" && PoseRecord !== null) {
				for (const k of Object.keys(PoseRecord)) {
					if (k) list.push({ name: k, label: k });
				}
			}
		} catch (e) { }
	}
	if (!list.length) {
		for (const n of ["Kneel", "KneelingSpread", "BaseLower", "LegsClosed", "Spread", "BaseUpper", "Hogtied", "AllFours"]) {
			list.push({ name: n, label: n });
		}
	}
	return list;
}

 
function WKPreviewPoseArray() {
	const C = WKEditTargetChar();
	if (WKUI.prevPose) return [WKUI.prevPose];
	try {
		if (C && Array.isArray(C.ActivePose) && C.ActivePose.length) return C.ActivePose.slice();
	} catch (e) { }
	return [];
}

 
function WKPreviewDraw(canvas, appearance, view, pose) {
	view = view || {};
	const zoom = (typeof view.zoom === "number" && isFinite(view.zoom)) ? view.zoom : 1;
	const ox = (typeof view.ox === "number" && isFinite(view.ox)) ? view.ox : 0;
	const oy = (typeof view.oy === "number" && isFinite(view.oy)) ? view.oy : 0;
	const poseArr = Array.isArray(pose) ? pose : WKPreviewPoseArray();
	const g = canvas && canvas.getContext ? canvas.getContext("2d") : null;
	if (!g || !Array.isArray(appearance)) return false;
	let temp = null;
	try {
		g.clearRect(0, 0, canvas.width, canvas.height);
		if (typeof CharacterCreate !== "function" || typeof CharacterRefresh !== "function") return false;
		const type = (typeof CharacterType !== "undefined" && CharacterType.SIMPLE) ? CharacterType.SIMPLE : "simple";
		temp = CharacterCreate("Female3DCG", type, "WardrobeKitPreview");
		const family = (typeof temp.AssetFamily === "string" && temp.AssetFamily) ? temp.AssetFamily : "Female3DCG";
		const items = [];
		for (const b of appearance) {
			if (!b || typeof b.Group !== "string" || typeof b.Name !== "string") continue;
			let it = null;
			try {
				if (typeof ServerBundledItemToAppearanceItem === "function") {
					it = ServerBundledItemToAppearanceItem(family, b);
				}
				if (!it && typeof AppearanceItem !== "undefined" && AppearanceItem &&
					typeof AppearanceItem.fromAsset === "function" && typeof AssetGet === "function") {
					const asset = AssetGet(family, b.Group, b.Name);
					if (asset) it = AppearanceItem.fromAsset(asset, { difficulty: b.Difficulty, color: b.Color, craft: b.Craft, property: b.Property });
				}
			} catch (e) { it = null; }
			if (it) items.push(it);
		}
		temp.Appearance = items;
		try { if (poseArr.length) temp.ActivePose = poseArr.slice(); } catch (e) { }
		CharacterRefresh(temp, false, false);
		if (!temp.Canvas || !temp.Canvas.width) return false;

		let srcCanvas = temp.Canvas;
		try {
			if (typeof DrawCharacterSegment === "function") {
				const seg = DrawCharacterSegment(temp, 0, 0, 500, 1000);
				if (seg && seg.width) srcCanvas = seg;
			}
		} catch (e) { }
		const dw = canvas.width || 500, dh = canvas.height || 1000;
		const fit = Math.min(dw / srcCanvas.width, dh / srcCanvas.height);
		const scale = fit * Math.max(0.1, zoom);
		const w = srcCanvas.width * scale, h = srcCanvas.height * scale;
		const x = (dw - w) / 2 + ox, y = (dh - h) / 2 + oy;
		g.drawImage(srcCanvas, x, y, w, h);
		return true;
	} catch (e) {
		WKErr("预览绘制失败", e);
		return false;
	} finally {
		if (temp && typeof CharacterDelete === "function") {
			try { CharacterDelete(temp); } catch (e) { }
		}
	}
}

 
function WKPreviewDrawWithView(appearance) {
	if (!WKUI.prevCanvas || !Array.isArray(appearance)) return false;
	return WKPreviewDraw(WKUI.prevCanvas, appearance, {
		zoom: WKUI.prevZoom,
		ox: WKUI.prevOX,
		oy: WKUI.prevOY,
	});
}

 
function WKPreviewClampPan() {
	const dw = 500, dh = 1000;
	const zoom = WKUI.prevZoom;
	const rangeX = Math.max(0, dw * (zoom - 1) / 2);
	const rangeY = Math.max(0, dh * (zoom - 1) / 2);
	WKUI.prevOX = Math.min(Math.max(WKUI.prevOX, -rangeX), rangeX);
	WKUI.prevOY = Math.min(Math.max(WKUI.prevOY, -rangeY), rangeY);
}

 
function WKPreviewBgLoad() {
	try {
		const raw = WKStorage.get("WardrobeKitPreviewBG:" + (WKStore.accountNum ?? 0));
		if (raw && WKHexOf(raw)) return WKHexOf(raw);
	} catch (e) { }
	return "#0c0e18";
}

function WKPreviewBgApply(color) {
	const h = WKHexOf(color) || "#0c0e18";
	WKUI.prevBg = h;
	try {
		if (WKUI.prevWin) WKUI.prevWin.style.background = h;
		if (WKUI.prevCanvas) WKUI.prevCanvas.style.background = h;
		WKStorage.set("WardrobeKitPreviewBG:" + (WKStore.accountNum ?? 0), h);
	} catch (e) { }
}

 
function WKPreviewSetPoseByName(name) {
	if (name !== null && typeof name !== "string") return;
	WKUI.prevPose = name || null;
	WKPreviewPoseButtonUpdate();
	WKPreviewPoseMenuClose();
	if (WKUI.prevAppearance) WKPreviewDrawWithView(WKUI.prevAppearance);
}

 
function WKPreviewPoseButtonUpdate() {
	if (!WKUI.prevPoseBtn) return;
	if (!WKUI.prevPoseImg) return;
	if (!WKUI.prevPoseText) return;
	if (WKUI.prevPose) {
		const entry = WKPoseEntries().find(e => e.name === WKUI.prevPose);
		WKUI.prevPoseImg.src = "Icons/Poses/" + WKUI.prevPose + ".png";
		WKUI.prevPoseImg.style.display = "inline-block";
		WKUI.prevPoseText.textContent = entry ? entry.label : WKUI.prevPose;
	} else {
		WKUI.prevPoseImg.style.display = "none";
		WKUI.prevPoseImg.removeAttribute("src");
		WKUI.prevPoseText.textContent = WKT("poseFollow");
	}
}

 
function WKPreviewPoseMenuBuild() {
	const panel = document.createElement("div");
	panel.setAttribute("data-wk-pose-drop", "1");
	WKApplyStyle(panel, {
		position: "absolute",
		left: "8px",
		top: "64px",
		width: "190px",
		maxHeight: "240px",
		overflowY: "auto",
		background: "#1c2136",
		border: "1px solid #4a5278",
		borderRadius: "8px",
		boxShadow: "0 6px 20px rgba(0,0,0,.6)",
		zIndex: "2147482995",
	});
	const mkRow = (name, label) => {
		const row = document.createElement("div");
		WKApplyStyle(row, {
			display: "flex",
			alignItems: "center",
			gap: "8px",
			padding: "6px 10px",
			cursor: "pointer",
			lineHeight: "1.3",
			fontFamily: "sans-serif",
		});
		row.addEventListener("mouseenter", () => { row.style.background = "#3a4160"; });
		row.addEventListener("mouseleave", () => { row.style.background = "transparent"; });
		if (name) {
			const img = document.createElement("img");
			img.src = "Icons/Poses/" + name + ".png";
			WKApplyStyle(img, { width: "28px", height: "28px", flex: "none" });
			img.addEventListener("error", () => { try { img.style.display = "none"; } catch (e) { } });
			row.appendChild(img);
		}
		const text = document.createElement("span");
		WKApplyStyle(text, { color: "#e8eaf6", fontSize: "13px", flex: "1", minWidth: "0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
		text.textContent = label;
		row.appendChild(text);
		row.addEventListener("click", () => WKPreviewSetPoseByName(name));
		return row;
	};
	panel.appendChild(mkRow(null, WKT("poseFollow")));
	for (const e of WKPoseEntries()) {
		panel.appendChild(mkRow(e.name, e.label));
	}
	return panel;
}

function WKPreviewPoseMenuToggle() {
	if (WKUI.prevPoseDrop) {
		WKPreviewPoseMenuClose();
		return;
	}
	if (!WKUI.prevWin) return;
	try {
		const panel = WKPreviewPoseMenuBuild();
		WKUI.prevWin.appendChild(panel);
		WKUI.prevPoseDrop = panel;
		 
		setTimeout(() => {
			document.addEventListener("mousedown", WKPreviewPoseMenuDocClose, true);
		}, 0);
	} catch (e) { WKErr("姿势下拉构建失败", e); }
}

function WKPreviewPoseMenuDocClose(ev) {
	try {
		if (WKUI.prevPoseDrop && WKUI.prevPoseBtn) {
			const insidePanel = ev.target && WKUI.prevPoseDrop.contains ? WKUI.prevPoseDrop.contains(ev.target) : false;
			const insideBtn = WKUI.prevPoseBtn.contains ? WKUI.prevPoseBtn.contains(ev.target) : false;
			if (!insidePanel && !insideBtn) WKPreviewPoseMenuClose();
		}
	} catch (e) { }
}

function WKPreviewPoseMenuClose() {
	if (WKUI.prevPoseDrop) {
		WKUI.prevPoseDrop.remove();
		WKUI.prevPoseDrop = null;
	}
	try { document.removeEventListener("mousedown", WKPreviewPoseMenuDocClose, true); } catch (e) { }
}

 
function WKPreviewSetLive() {
	if (!WKUI.prevWin || WKUI.prevLive) return;
	WKUI.prevLive = true;
	WKUI.prevAppearance = null;
	WKUI.prevHash = null;
	try {
		if (WKUI.prevTitlebar) {
			const t = WKUI.prevTitlebar.firstChild;
			if (t && WKUI.prevTitleBase) t.textContent = WKUI.prevTitleBase + " · " + WKT("liveBadge");
		}
	} catch (e) { }
	const C = WKEditTargetChar();
	if (C) {
		try {
			const a = WKAppearanceBundleOf(C);
			if (a !== null) {
				WKUI.prevHash = WKHashOf(a);
				WKUI.prevAppearance = a;
				WKPreviewDrawWithView(a);
			}
		} catch (e) { }
	}
}

function WKPreviewHide() {
	WKPreviewStopLoop();
	if (WKUI.prevWin) {
		WKUI.prevWin.remove();
		WKUI.prevWin = null;
	}
	WKUI.prevCanvas = null;
	WKUI.prevTitlebar = null;
	WKUI.prevRef = null;
	WKUI.prevLive = false;
	WKUI.prevAppearance = null;
	WKUI.prevHash = null;
	WKUI.prevTitleBase = null;
	WKUI.prevZoom = 1;
	WKUI.prevOX = 0;
	WKUI.prevOY = 0;
	WKUI.prevPose = null;
	WKUI.prevPoseBtn = null;
	WKUI.prevPoseImg = null;
	WKUI.prevPoseText = null;
	WKUI.prevPoseDrop = null;
	WKPreviewPoseMenuClose();
	WKUI.prevBg = "#0C0E18";
}

 
function WKPreviewStartLoop() {
	if (WKState.previewTimer) return;
	WKState.previewTick = 0;
	try {
		WKState.previewTimer = setInterval(() => {
			try {
				WKState.previewTick++;
				if (!WKUI.prevWin || !WKUI.prevCanvas) {
					WKPreviewStopLoop();
					return;
				}
				if (WKUI.prevLive) {
					const C = WKEditTargetChar();
					if (!C) return;
					const appearance = WKAppearanceBundleOf(C);
					if (appearance === null) return;
					const hash = WKHashOf(appearance);
					if (hash !== WKUI.prevHash || WKState.previewTick % 3 === 0) {
						WKUI.prevHash = hash;
						WKUI.prevAppearance = appearance;
						WKPreviewDrawWithView(appearance);
					}
				} else {
					if (WKState.previewTick <= 2 && WKUI.prevAppearance) {
						WKPreviewDrawWithView(WKUI.prevAppearance);
					}
				}
			} catch (e) { WKErr("预览刷新失败", e); }
		}, 700);
	} catch (e) { WKErr("预览循环启动失败", e); }
}

function WKPreviewStopLoop() {
	if (WKState.previewTimer) {
		try { clearInterval(WKState.previewTimer); } catch (e) { }
		WKState.previewTimer = null;
	}
	WKState.previewTick = 0;
}

function WKPreviewLayout() {
	const w = WKUI.prevWin;
	if (!w) return;
	const vw = window.innerWidth || 1000, vh = window.innerHeight || 700;
	const pw = Math.min(340, Math.max(220, Math.floor((WKUI.geo.h || 560) * 0.42)));
	const ph = pw * 2;
	let x;
	if (WKUI.win) x = WKUI.geo.x + WKUI.geo.w + 14;
	else x = vw - pw - 16;
	if (x + pw > vw - 8) x = Math.max(8, vw - pw - 8);
	const y = Math.min(Math.max(WKUI.win ? WKUI.geo.y : 16, 8), Math.max(8, vh - ph - 8));
	w.style.left = x + "px";
	w.style.top = y + "px";
	w.style.width = pw + "px";
	w.style.height = (ph + 64) + "px";
	if (WKUI.prevCanvas) {
		WKUI.prevCanvas.style.width = pw + "px";
		WKUI.prevCanvas.style.height = ph + "px";
	}
}

 
function WKPreviewShow(appearance, titleText, opts) {
	opts = opts || {};
	if (!opts.live && !Array.isArray(appearance)) { WKToast(WKT("toastRecordedNone")); return; }
	WKPreviewHide();
	const win = document.createElement("div");
	win.setAttribute("data-wk", "1");
	WKApplyStyle(win, {
		position: "fixed",
		zIndex: "2147482990",
		background: "#0c0e18",
		border: "2px solid #ffffff",
		borderRadius: "8px",
		boxShadow: "0 6px 30px rgba(0,0,0,.6)",
		overflow: "hidden",
		userSelect: "none",
	});
	const titlebar = document.createElement("div");
	titlebar.setAttribute("data-wk-preview-bar", "1");
	WKApplyStyle(titlebar, {
		display: "flex",
		alignItems: "center",
		justifyContent: "space-between",
		background: "#1a1e30",
		padding: "4px 8px",
		cursor: "move",
		lineHeight: "1.3",
		position: "relative",
		zIndex: "1",
	});
	const title = document.createElement("span");
	WKApplyStyle(title, {
		color: "#c4b5fd",
		fontWeight: "bold",
		fontSize: "13px",
		whiteSpace: "nowrap",
		overflow: "hidden",
		textOverflow: "ellipsis",
		fontFamily: "sans-serif",
	});
	title.textContent = titleText || WKT("previewTitle");
	const close = document.createElement("button");
	WKApplyStyle(close, {
		background: "transparent",
		border: "1px solid #4a5278",
		color: "#c5cbe8",
		borderRadius: "6px",
		width: "26px",
		height: "26px",
		fontSize: "15px",
		lineHeight: "1",
		cursor: "pointer",
		padding: "0",
		flex: "none",
		marginLeft: "8px",
	});
	close.textContent = "✕";
	close.title = WKT("closeTitle");
	close.addEventListener("click", () => { WKPreviewHide(); });
	titlebar.appendChild(title);
	titlebar.appendChild(close);
	win.appendChild(titlebar);

	 
	const ctrlbar = document.createElement("div");
	WKApplyStyle(ctrlbar, {
		display: "flex",
		alignItems: "center",
		gap: "6px",
		background: "#151727",
		padding: "4px 8px",
		lineHeight: "1.3",
		position: "relative",
		zIndex: "1",
	});

	 
	const poseLabel = document.createElement("span");
	WKApplyStyle(poseLabel, { color: "#9aa3c7", fontSize: "12px", flex: "none", fontFamily: "sans-serif" });
	poseLabel.textContent = WKT("previewPose") + ":";
	ctrlbar.appendChild(poseLabel);
	const poseBtn = document.createElement("button");
	poseBtn.setAttribute("data-wk-pose-btn", "1");
	WKApplyStyle(poseBtn, {
		display: "flex",
		alignItems: "center",
		gap: "6px",
		background: "#2a2f45",
		border: "1px solid #4a5278",
		color: "#e8eaf6",
		borderRadius: "6px",
		padding: "2px 8px",
		fontSize: "13px",
		lineHeight: "1.3",
		cursor: "pointer",
		flex: "none",
	});
	const poseImg = document.createElement("img");
	WKApplyStyle(poseImg, { width: "20px", height: "20px", flex: "none", display: "none" });
	const poseText = document.createElement("span");
	WKApplyStyle(poseText, {
		color: "#e8eaf6",
		fontSize: "13px",
		flex: "none",
		maxWidth: "110px",
		whiteSpace: "nowrap",
		overflow: "hidden",
		textOverflow: "ellipsis",
		fontFamily: "sans-serif",
	});
	poseText.textContent = WKT("poseFollow");
	poseBtn.appendChild(poseImg);
	poseBtn.appendChild(poseText);
	poseBtn.title = WKT("previewPose");
	poseBtn.addEventListener("click", (e) => {
		e.stopPropagation();
		WKPreviewPoseMenuToggle();
	});
	ctrlbar.appendChild(poseBtn);

	const spacer = document.createElement("span");
	WKApplyStyle(spacer, { flex: "1" });
	ctrlbar.appendChild(spacer);

	 
	const bgLabel = document.createElement("span");
	WKApplyStyle(bgLabel, { color: "#9aa3c7", fontSize: "12px", flex: "none", fontFamily: "sans-serif" });
	bgLabel.textContent = WKT("previewBg") + ":";
	ctrlbar.appendChild(bgLabel);
	const mkBg = (color) => {
		const d = document.createElement("div");
		WKApplyStyle(d, {
			width: "20px",
			height: "20px",
			borderRadius: "4px",
			background: color,
			border: "1px solid #4a5278",
			cursor: "pointer",
			flex: "none",
			boxSizing: "border-box",
		});
		d.title = color;
		d.addEventListener("click", () => WKPreviewBgApply(color));
		return d;
	};
	ctrlbar.appendChild(mkBg("#0c0e18"));
	ctrlbar.appendChild(mkBg("#c0c0c8"));
	ctrlbar.appendChild(mkBg("#ffffff"));
	 
	const bgInput = document.createElement("input");
	bgInput.type = "color";
	WKApplyStyle(bgInput, {
		width: "26px",
		height: "22px",
		border: "1px solid #4a5278",
		borderRadius: "4px",
		background: "#2a2f45",
		cursor: "pointer",
		padding: "0",
		flex: "none",
	});
	bgInput.title = WKT("previewBg");
	bgInput.addEventListener("input", () => {
		if (bgInput.value) WKPreviewBgApply(bgInput.value);
	});
	ctrlbar.appendChild(bgInput);
	win.appendChild(ctrlbar);

	const canvas = document.createElement("canvas");
	canvas.id = "wk-preview-canvas";
	canvas.setAttribute("data-wk", "1");
	canvas.width = 500;
	canvas.height = 1000;
	WKApplyStyle(canvas, {
		display: "block",
		background: "#0c0e18",
		cursor: "default",
	});
	canvas.title = WKT("previewZoomHint");
	win.appendChild(canvas);
	document.body.appendChild(win);

	WKUI.prevWin = win;
	WKUI.prevCanvas = canvas;
	WKUI.prevTitlebar = titlebar;
	WKUI.prevRef = titleText + ":" + WKNow();
	WKUI.prevLive = !!opts.live;
	WKUI.prevTitleBase = titleText || WKT("previewTitle");
	WKUI.prevAppearance = opts.live ? null : appearance;
	WKUI.prevHash = opts.live ? null : WKHashOf(appearance);
	WKUI.prevZoom = 1;
	WKUI.prevOX = 0;
	WKUI.prevOY = 0;
	WKUI.prevPose = null;
	WKUI.prevPoseBtn = poseBtn;
	WKUI.prevPoseImg = poseImg;
	WKUI.prevPoseText = poseText;
	WKUI.prevBg = WKPreviewBgLoad();
	WKPreviewBgApply(WKUI.prevBg);
	if (WKUI.prevLive && title) {
		title.textContent = WKUI.prevTitleBase + " · " + WKT("liveBadge");
	}

	 
	canvas.addEventListener("wheel", (e) => {
		try {
			e.preventDefault();
			e.stopPropagation();
			const factor = Math.exp(-e.deltaY * 0.0015);
			WKUI.prevZoom = Math.min(8, Math.max(0.1, WKUI.prevZoom * factor));
			WKPreviewClampPan();
			if (WKUI.prevAppearance) WKPreviewDrawWithView(WKUI.prevAppearance);
			canvas.style.cursor = WKUI.prevZoom > 1 ? "grab" : "default";
		} catch (err) { }
	}, { passive: false });

	 

	WKPreviewLayout();
	WKPreviewDrawWithView(appearance || []);
	WKPreviewStartLoop();
}

 

function WKUIDotKey() {
	return "WardrobeKitDot:" + (WKStore.accountNum ?? 0);
}

function WKUIDotClamp(x, y) {
	const vw = window.innerWidth || 1000, vh = window.innerHeight || 700;
	const size = 46;
	return {
		x: Math.min(Math.max(x, 4), Math.max(4, vw - size - 4)),
		y: Math.min(Math.max(y, 4), Math.max(4, vh - size - 4)),
	};
}

function WKUIDotSave() {
	try { WKStorage.set(WKUIDotKey(), JSON.stringify(WKUI.dotPos)); } catch (e) { }
}

function WKUIDotBuild() {
	if (WKUI.dot) return;
	let pos = { x: null, y: null };
	try {
		const raw = WKStorage.get(WKUIDotKey());
		if (raw) {
			const g = JSON.parse(raw);
			if (g && typeof g === "object" && typeof g.x === "number" && typeof g.y === "number") pos = { x: g.x, y: g.y };
		}
	} catch (e) { }
	if (pos.x === null || pos.y === null) {
		pos = { x: (window.innerWidth || 1000) - 110, y: (window.innerHeight || 700) - 60 };
	}
	const clamped = WKUIDotClamp(pos.x, pos.y);
	WKUI.dotPos = clamped;

	const dot = document.createElement("div");
	dot.id = "wk-dot";
	dot.setAttribute("data-wk", "1");
	WKApplyStyle(dot, {
		position: "fixed",
		left: clamped.x + "px",
		top: clamped.y + "px",
		width: "46px",
		height: "46px",
		borderRadius: "50%",
		background: "rgba(124,58,237,.9)",
		border: "2px solid #c4b5fd",
		color: "#ffffff",
		display: "flex",
		alignItems: "center",
		justifyContent: "center",
		cursor: "pointer",
		userSelect: "none",
		boxShadow: "0 3px 14px rgba(0,0,0,.5)",
		zIndex: "2147483100",
	});
	dot.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor">' +
		'<path d="M20.38 3.46L16 2a4 4 0 01-8 0L3.62 3.46a2 2 0 00-1.34 2.23l.58 3.47a1 1 0 00.99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 002-2V10h2.15a1 1 0 00.99-.84l.58-3.47a2 2 0 00-1.34-2.23z"/></svg>';
	dot.title = WKT("dotTitle");

	 

	window.addEventListener("resize", () => {
		const c = WKUIDotClamp(WKUI.dotPos.x, WKUI.dotPos.y);
		WKUI.dotPos = c;
		dot.style.left = c.x + "px";
		dot.style.top = c.y + "px";
	});

	document.body.appendChild(dot);
	WKUI.dot = dot;
}

 

const WKUI = {
	win: null,
	titlebar: null,
	titleEl: null,
	toolbar: null,
	body: null,
	histHead: null,
	histList: null,
	palHead: null,
	palGrid: null,
	palAddRow: null,
	palInput: null,
	statusEl: null,
	resizeHandle: null,
	toastEl: null,
	styleEl: null,

	open: false,
	minimized: false,
	geo: { x: 80, y: 80, w: 880, h: 580 },
	lang: "zh",

	prevWin: null,
	prevCanvas: null,
	prevTitlebar: null,
	prevRef: null,
	prevLive: false,
	prevAppearance: null,
	prevHash: null,
	prevTitleBase: null,
	prevZoom: 1,
	prevOX: 0,
	prevOY: 0,
	prevPose: null,
	prevPoseBtn: null,
	prevPoseImg: null,
	prevPoseText: null,
	prevPoseDrop: null,
	prevBg: "#0C0E18",

	dot: null,
	dotPos: { x: null, y: null },

	dirty: true,
	tickId: null,
	winDrag: null,
	resDrag: null,
	escHandler: null,
	keyHandler: null,
	arm: null,
	armTimer: null,
};

let WKToastTimer = null;

function WKApplyStyle(el, styles) {
	if (!el || !el.style) return el;
	for (const k of Object.keys(styles)) {
		try { el.style[k] = styles[k]; } catch (e) { }
	}
	return el;
}

 

const WKDrag = {
	active: null,    
};

function WKWinOn(type, fn, opts) {
	try { window.addEventListener(type, fn, opts || true); return true; } catch (e) { return false; }
}

function WKWinOff(type, fn, opts) {
	try { window.removeEventListener(type, fn, opts || true); } catch (e) { }
}

 
function WKHitWK(ev, sel) {
	const t = ev && ev.target;
	if (!t || typeof t.closest !== "function") return null;
	if (sel) return t.closest(sel);
	return t.closest("[data-wk]");
}

 
function WKDragPick(ev) {
	const t = ev && ev.target;
	if (!t || typeof t.closest !== "function") return null;
	if (t.closest("button, input, textarea, select, [role='menuitem']")) return null;  
	if (t.closest("#wk-titlebar")) return { mode: "win" };
	if (t.closest("#wk-resize")) return { mode: "resize" };
	if (t.closest("#wk-dot")) return { mode: "dot" };
	if (t.closest("[data-wk-preview-bar]")) return { mode: "prevwin" };
	if (t.closest("#wk-preview-canvas") && WKUI.prevZoom > 1) return { mode: "prevcanvas" };
	return null;
}

function WKDragStart(ev, cfg) {
	const mode = cfg.mode;
	const d = {
		mode,
		startX: ev.clientX,
		startY: ev.clientY,
		moved: false,
	};
	if (mode === "win" || mode === "resize") {
		d.startLeft = WKUI.geo.x;
		d.startTop = WKUI.geo.y;
		d.startW = WKUI.geo.w;
		d.startH = WKUI.geo.h;
	} else if (mode === "dot") {
		d.startLeft = WKUI.dotPos.x;
		d.startTop = WKUI.dotPos.y;
	} else if (mode === "prevwin") {
		const w = WKUI.prevWin;
		d.startLeft = w ? (parseFloat(w.style.left) || 0) : 0;
		d.startTop = w ? (parseFloat(w.style.top) || 0) : 0;
	} else if (mode === "prevcanvas") {
		d.startOX = WKUI.prevOX;
		d.startOY = WKUI.prevOY;
	}
	WKDrag.active = d;
}

function WKDragMove(ev) {
	const d = WKDrag.active;
	if (!d) return;
	const dx = ev.clientX - d.startX, dy = ev.clientY - d.startY;
	if (Math.abs(dx) > 4 || Math.abs(dy) > 4) d.moved = true;
	if (d.mode === "win") {
		const vw = window.innerWidth || 1000, vh = window.innerHeight || 700;
		const nx = Math.min(Math.max(d.startLeft + dx, -WKUI.geo.w + 140), vw - 60);
		const ny = Math.min(Math.max(d.startTop + dy, 0), vh - 50);
		WKUI.geo.x = nx;
		WKUI.geo.y = ny;
		if (WKUI.win) {
			WKUI.win.style.left = nx + "px";
			WKUI.win.style.top = ny + "px";
		}
		WKPreviewLayout();
	} else if (d.mode === "resize") {
		const vw = window.innerWidth || 1000, vh = window.innerHeight || 700;
		WKUI.geo.w = Math.min(Math.max(d.startW + dx, 420), vw - 10);
		WKUI.geo.h = Math.min(Math.max(d.startH + dy, 320), vh - 10);
		if (WKUI.win) {
			WKUI.win.style.width = WKUI.geo.w + "px";
			WKUI.win.style.height = (WKUI.minimized ? 44 : WKUI.geo.h) + "px";
		}
	} else if (d.mode === "dot") {
		if (!d.moved) return;
		const c = WKUIDotClamp(d.startLeft + dx, d.startTop + dy);
		WKUI.dotPos = c;
		if (WKUI.dot) {
			WKUI.dot.style.left = c.x + "px";
			WKUI.dot.style.top = c.y + "px";
		}
	} else if (d.mode === "prevwin") {
		if (!WKUI.prevWin) return;
		const vw = window.innerWidth || 1000, vh = window.innerHeight || 700;
		WKUI.prevWin.style.left = Math.min(Math.max(d.startLeft + dx, 0), Math.max(0, vw - 100)) + "px";
		WKUI.prevWin.style.top = Math.min(Math.max(d.startTop + dy, 0), Math.max(0, vh - 40)) + "px";
	} else if (d.mode === "prevcanvas") {
		WKUI.prevOX = d.startOX + dx * (500 / Math.max(50, parseFloat(WKUI.prevCanvas.style.width) || 300));
		WKUI.prevOY = d.startOY + dy * (1000 / Math.max(100, parseFloat(WKUI.prevCanvas.style.height) || 600));
		WKPreviewClampPan();
		if (WKUI.prevAppearance) WKPreviewDrawWithView(WKUI.prevAppearance);
	}
}

function WKDragEnd(ev) {
	const d = WKDrag.active;
	if (!d) return;
	WKDrag.active = null;
	if (d.mode === "win" || d.mode === "resize") {
		WKUIGeoSave();
		WKPreviewLayout();
	} else if (d.mode === "dot") {
		if (d.moved) WKUIDotSave();
		else WardrobeKitToggle();
	} else if (d.mode === "prevcanvas") {
		if (WKUI.prevCanvas) WKUI.prevCanvas.style.cursor = WKUI.prevZoom > 1 ? "grab" : "default";
	}
}

 
function WKInstallPointerShield() {
	if (WKState.shield) return;
	WKState.shield = true;

	WKWinOn("mousedown", (ev) => {
		try {
			 
			if (WKUI.prevPoseDrop) {
				const inside = WKHitWK(ev, "[data-wk-pose-drop]") || WKHitWK(ev, "[data-wk-pose-btn]");
				if (!inside) WKPreviewPoseMenuClose();
			}
			const inWK = WKHitWK(ev);
			if (!inWK) return;  
			

 
			const cfg = WKDragPick(ev);
			if (cfg && !WKDrag.active) {
				ev.preventDefault();
				WKDragStart(ev, cfg);
			}
			ev.stopImmediatePropagation();
		} catch (e) { WKErr("指针护盾 mousedown 失败", e); }
	});

	WKWinOn("mousemove", (ev) => {
		if (!WKDrag.active) return;
		try {
			ev.preventDefault();
			ev.stopImmediatePropagation();
			WKDragMove(ev);
		} catch (e) { }
	});

	WKWinOn("mouseup", (ev) => {
		if (!WKDrag.active) return;
		try {
			ev.preventDefault();
			ev.stopImmediatePropagation();
			WKDragEnd(ev);
		} catch (e) { }
	});

	

 
	WKWinOn("pointerdown", (ev) => {
		try {
			if (!WKHitWK(ev)) return;
			const cfg = WKDragPick(ev);
			if (cfg && !WKDrag.active) {
				ev.preventDefault();
				WKDragStart(ev, cfg);
			}
			ev.stopImmediatePropagation();
		} catch (e) { WKErr("指针护盾 pointerdown 失败", e); }
	});
	WKWinOn("pointermove", (ev) => {
		if (!WKDrag.active) return;
		try {
			ev.preventDefault();
			ev.stopImmediatePropagation();
			WKDragMove(ev);
		} catch (e) { }
	});
	WKWinOn("pointerup", (ev) => {
		if (!WKDrag.active) return;
		try {
			ev.preventDefault();
			ev.stopImmediatePropagation();
			WKDragEnd(ev);
		} catch (e) { }
	});
	try {
		window.addEventListener("touchstart", (ev) => {
			try { if (WKHitWK(ev)) ev.stopImmediatePropagation(); } catch (e) { }
		}, { capture: true, passive: false });
	} catch (e) { }
}

function WKUIEnsureStyle() {
	if (WKUI.styleEl || document.getElementById("wardrobekit-style")) return;
	const style = document.createElement("style");
	style.id = "wardrobekit-style";
	style.textContent = [
		"#wk-win{border:4px solid #ffffff;border-radius:12px;box-shadow:0 8px 40px rgba(0,0,0,.65);",
		"color:#e8eaf6;font-size:13px;font-family:sans-serif;}",
		"#wk-titlebar{gap:6px;padding:8px 10px;background:#1a1e30;border-bottom:1px solid #2a2f45;}",
		"#wk-title{color:#c4b5fd;font-weight:bold;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}",
		"#wk-toolbar{gap:6px;padding:8px;background:#151727;border-bottom:1px solid #2a2f45;}",
		"#wk-resize::after{content:'';position:absolute;right:4px;bottom:4px;width:10px;height:10px;",
		"border-right:2px solid #8891b8;border-bottom:2px solid #8891b8;}",
		".wk-btn{background:#2a2f45;color:#e8eaf6;border:1px solid #4a5278;border-radius:8px;padding:7px 14px;",
		"font-size:18px;cursor:pointer;line-height:1.3;}",
		".wk-btn:hover{background:#3a4160;}",
		".wk-btn-danger{background:#5c2030;border-color:#ff5566;}",
		".wk-btn-ok{background:#1d4d33;border-color:#4ade80;}",
		".wk-btn-mini{padding:3px 10px;font-size:15px;margin-left:8px;flex:none;}",
		".wk-btn-title{background:transparent;border:1px solid #4a5278;color:#c5cbe8;border-radius:6px;",
		"width:34px;height:34px;font-size:20px;line-height:1;cursor:pointer;padding:0;}",
		".wk-btn-title:hover{background:#3a4160;}",
		"#wk-toast{position:fixed;left:16px;top:16px;z-index:2147483600;background:#2a2f45;",
		"border:1px solid #c4b5fd;color:#c4b5fd;border-radius:8px;padding:10px 16px;font-size:14px;",
		"font-family:sans-serif;transition:opacity .4s;display:none;max-width:420px;pointer-events:none;}",
	].join("\n");
	document.head.appendChild(style);
	WKUI.styleEl = style;
}

function WKUIGeoLoad() {
	try {
		const raw = WKStorage.get("WardrobeKitWin:" + (WKStore.accountNum ?? 0));
		if (raw) {
			const g = JSON.parse(raw);
			if (g && typeof g === "object") {
				const vw = window.innerWidth || 1000, vh = window.innerHeight || 700;
				WKUI.geo.w = Math.min(Math.max(+g.w || 880, 420), vw - 10);
				WKUI.geo.h = Math.min(Math.max(+g.h || 580, 320), vh - 10);
				WKUI.geo.x = Math.min(Math.max(+g.x || 80, 0), Math.max(0, vw - 200));
				WKUI.geo.y = Math.min(Math.max(+g.y || 80, 0), Math.max(0, vh - 80));
			}
		}
	} catch (e) { }
}

function WKUIGeoSave() {
	try {
		WKStorage.set("WardrobeKitWin:" + (WKStore.accountNum ?? 0), JSON.stringify(WKUI.geo));
	} catch (e) { }
}

function WKUIBuildWindow() {
	if (WKUI.win) return;
	WKUIEnsureStyle();
	WKUIGeoLoad();

	const win = document.createElement("div");
	win.id = "wk-win";
	win.setAttribute("data-wk", "1");
	WKApplyStyle(win, {
		position: "fixed",
		left: WKUI.geo.x + "px",
		top: WKUI.geo.y + "px",
		width: WKUI.geo.w + "px",
		height: WKUI.geo.h + "px",
		background: "#10101c",
		zIndex: "2147483200",
		display: "flex",
		flexDirection: "column",
	});

	const titlebar = document.createElement("div");
	titlebar.id = "wk-titlebar";
	WKApplyStyle(titlebar, { display: "flex", alignItems: "center", cursor: "move", lineHeight: "1.3" });
	const title = document.createElement("span");
	title.id = "wk-title";
	WKApplyStyle(title, {
		flex: "1",
		color: "#c4b5fd",
		fontWeight: "bold",
		fontSize: "15px",
		whiteSpace: "nowrap",
		overflow: "hidden",
		textOverflow: "ellipsis",
	});
	title.textContent = WKT("title");
	titlebar.appendChild(title);

	 
	const btnMin = document.createElement("button");
	btnMin.className = "wk-btn-title";
	WKApplyStyle(btnMin, {
		background: "transparent",
		border: "1px solid #4a5278",
		color: "#c5cbe8",
		borderRadius: "6px",
		width: "34px",
		height: "34px",
		fontSize: "20px",
		lineHeight: "1",
		cursor: "pointer",
		padding: "0",
	});
	btnMin.textContent = "—";
	btnMin.title = WKT("minTitle");
	btnMin.addEventListener("click", (e) => {
		e.stopPropagation();
		WKUI.minimized = !WKUI.minimized;
		if (WKUI.minimized) {
			WKUI.body.style.display = "none";
			WKUI.toolbar.style.display = "none";
			WKUI.win.style.height = "44px";
		} else {
			WKUI.body.style.display = "flex";
			WKUI.toolbar.style.display = "flex";
			WKUI.win.style.height = WKUI.geo.h + "px";
		}
	});
	titlebar.appendChild(btnMin);
	const btnClose = document.createElement("button");
	btnClose.className = "wk-btn-title";
	WKApplyStyle(btnClose, {
		background: "transparent",
		border: "1px solid #4a5278",
		color: "#c5cbe8",
		borderRadius: "6px",
		width: "34px",
		height: "34px",
		fontSize: "20px",
		lineHeight: "1",
		cursor: "pointer",
		padding: "0",
	});
	btnClose.textContent = "✕";
	btnClose.title = WKT("closeTitle");
	btnClose.addEventListener("click", (e) => {
		e.stopPropagation();
		WardrobeKitClose();
	});
	titlebar.appendChild(btnClose);
	win.appendChild(titlebar);

	const toolbar = document.createElement("div");
	toolbar.id = "wk-toolbar";
	WKApplyStyle(toolbar, { display: "flex", alignItems: "center", flexWrap: "wrap" });
	win.appendChild(toolbar);

	const body = document.createElement("div");
	WKApplyStyle(body, { flex: "1", display: "flex", minHeight: "0" });
	win.appendChild(body);

	 
	const left = document.createElement("div");
	WKApplyStyle(left, {
		flex: "1",
		minWidth: "0",
		display: "flex",
		flexDirection: "column",
		background: "#10101c",
		borderRight: "1px solid #2a2f45",
	});
	const histHead = document.createElement("div");
	histHead.id = "wk-histhead";
	WKApplyStyle(histHead, { padding: "8px 10px 6px", borderBottom: "1px solid #2a2f45", flex: "none" });
	const histList = document.createElement("div");
	histList.id = "wk-histlist";
	WKApplyStyle(histList, { flex: "1", overflowY: "auto", minHeight: "0" });
	left.appendChild(histHead);
	left.appendChild(histList);
	body.appendChild(left);

	 
	const right = document.createElement("div");
	WKApplyStyle(right, {
		width: "300px",
		flex: "none",
		display: "flex",
		flexDirection: "column",
		background: "#12121f",
		borderLeft: "1px solid #2a2f45",
	});
	const palHead = document.createElement("div");
	palHead.id = "wk-palhead";
	WKApplyStyle(palHead, { padding: "8px 10px 6px", borderBottom: "1px solid #2a2f45", flex: "none" });
	const palGrid = document.createElement("div");
	palGrid.id = "wk-palgrid";
	WKApplyStyle(palGrid, { flex: "1", overflowY: "auto", padding: "8px", minHeight: "0" });
	const palAddRow = document.createElement("div");
	palAddRow.id = "wk-paladdrow";
	WKApplyStyle(palAddRow, { display: "flex", gap: "6px", padding: "8px", borderTop: "1px solid #2a2f45", flex: "none" });
	right.appendChild(palHead);
	right.appendChild(palGrid);
	right.appendChild(palAddRow);
	body.appendChild(right);

	 
	const statusEl = document.createElement("div");
	statusEl.id = "wk-status";
	WKApplyStyle(statusEl, {
		padding: "5px 10px",
		borderTop: "1px solid #2a2f45",
		background: "#151727",
		color: "#9aa3c7",
		fontSize: "12px",
		flex: "none",
	});
	win.appendChild(statusEl);

	 
	const resizeHandle = document.createElement("div");
	resizeHandle.id = "wk-resize";
	WKApplyStyle(resizeHandle, {
		position: "absolute",
		right: "0",
		bottom: "0",
		width: "20px",
		height: "20px",
		cursor: "nwse-resize",
	});
	win.appendChild(resizeHandle);

	document.body.appendChild(win);

	WKUI.win = win;
	WKUI.titlebar = titlebar;
	WKUI.titleEl = title;
	WKUI.toolbar = toolbar;
	WKUI.body = body;
	WKUI.histHead = histHead;
	WKUI.histList = histList;
	WKUI.palHead = palHead;
	WKUI.palGrid = palGrid;
	WKUI.palAddRow = palAddRow;
	WKUI.statusEl = statusEl;
	WKUI.resizeHandle = resizeHandle;

	
 
	WKUIBuildToolbar();
	WKUIRenderAll();
}

 
function WKUIBuildToolbar() {
	if (!WKUI.toolbar) return;
	WKUI.toolbar.innerHTML = "";

	 
	const mk = (cls, label, title, colors, onClick) => {
		const b = document.createElement("button");
		b.className = cls || "wk-btn";
		WKApplyStyle(b, {
			background: (colors && colors.bg) ? colors.bg
				: (cls === "wk-btn wk-btn-ok") ? "#1d4d33"
				: (cls === "wk-btn wk-btn-danger") ? "#5c2030" : "#2a2f45",
			border: (colors && colors.border) ? "1px solid " + colors.border
				: (cls === "wk-btn wk-btn-ok") ? "1px solid #4ade80"
				: (cls === "wk-btn wk-btn-danger") ? "1px solid #ff5566" : "1px solid #4a5278",
			color: "#e8eaf6",
			borderRadius: "8px",
			padding: "7px 14px",
			fontSize: "18px",
			cursor: "pointer",
			lineHeight: "1.3",
		});
		b.textContent = label;
		if (title) b.title = title;
		if (onClick) b.addEventListener("click", onClick);
		WKUI.toolbar.appendChild(b);
		return b;
	};

	mk("wk-btn wk-btn-ok", WKT("btnUndo"), "Ctrl+Z", null, () => { WKUndo(); WKUIRenderAll(); });
	mk("wk-btn wk-btn-ok", WKT("btnRedo"), "Ctrl+Y / Ctrl+Shift+Z", null, () => { WKRedo(); WKUIRenderAll(); });
	mk("wk-btn", WKT("btnRecord"), "", null, () => { WKRecordCurrentColors(); });
	mk("wk-btn", WKT("btnPreviewNow"), "", null, () => {
		const C = WKEditTargetChar();
		if (!C) { WKToast(WKT("toastNoTarget")); return; }
		const appearance = WKAppearanceBundleOf(C);
		if (appearance === null) { WKToast(WKT("toastRecordedNone")); return; }
		 
		WKPreviewShow(appearance, WKT("previewNowTitle", WKTargetName()) + " · " + WKT("liveBadge"), { live: true });
	});
	mk("wk-btn wk-btn-danger", WKUIArmIs("history") ? WKT("armClearHistory") : WKT("btnClearHistory"), "", null, () => {
		if (!WKUIArmIs("history")) {
			WKUIArm("history");
			WKUIBuildToolbar();
			return;
		}
		WKUIArmClear();
		const n = WKClearHistory();
		if (n > 0) WKToast(WKT("toastHistoryCleared", n));
		WKUIBuildToolbar();
		WKUIRenderAll();
	});
	mk("wk-btn wk-btn-danger", WKUIArmIs("palette") ? WKT("armClearPalette") : WKT("btnClearPalette"), "", null, () => {
		if (!WKUIArmIs("palette")) {
			WKUIArm("palette");
			WKUIBuildToolbar();
			return;
		}
		WKUIArmClear();
		const n = WKPaletteClear();
		if (n > 0) WKToast(WKT("toastPaletteCleared", n));
		WKUIBuildToolbar();
		WKUIRenderAll();
	});

	const spacer = document.createElement("span");
	WKApplyStyle(spacer, { flex: "1" });
	WKUI.toolbar.appendChild(spacer);

	 
	const langBtn = document.createElement("button");
	langBtn.className = "wk-btn wk-btn-mini";
	WKApplyStyle(langBtn, {
		background: "#2a2f45",
		border: "1px solid #4a5278",
		color: "#e8eaf6",
		borderRadius: "8px",
		padding: "3px 10px",
		fontSize: "15px",
		cursor: "pointer",
		lineHeight: "1.3",
		marginLeft: "8px",
		flex: "none",
	});
	langBtn.textContent = WKUI.lang === "zh" ? WKT("btnLangEn") : WKT("btnLangZh");
	langBtn.title = WKUI.lang === "zh" ? "Switch to English" : "切换中文";
	langBtn.addEventListener("click", () => {
		WKUI.lang = WKUI.lang === "zh" ? "en" : "zh";
		try { WKStorage.set("WardrobeKitLang", WKUI.lang); } catch (e) { }
		WKUI.titleEl.textContent = WKT("title");
		if (WKUI.dot) WKUI.dot.title = WKT("dotTitle");
		WKUIBuildToolbar();
		WKUIRenderAll();
	});
	WKUI.toolbar.appendChild(langBtn);
}

 
function WKUIBuildHistory() {
	if (!WKUI.histHead || !WKUI.histList) return;
	WKUI.histHead.innerHTML = "";
	WKUI.histList.innerHTML = "";

	const C = WKEditTargetChar();
	const num = C ? C.MemberNumber : (WKStore.load().cur);
	const char = num !== null && num !== undefined ? WKCharOf(num) : null;

	const headTitle = document.createElement("div");
	WKApplyStyle(headTitle, { color: "#c4b5fd", fontWeight: "bold", fontSize: "14px" });
	headTitle.textContent = WKT("headHistory") + " · " + WKTargetName();
	WKUI.histHead.appendChild(headTitle);

	const tips = document.createElement("div");
	WKApplyStyle(tips, { color: "#6d7699", fontSize: "11px", marginTop: "3px", lineHeight: "1.5" });
	tips.textContent = WKT("tipHistory");
	WKUI.histHead.appendChild(tips);

	if (!char || !char.history.length) {
		const empty = document.createElement("div");
		WKApplyStyle(empty, { color: "#6d7699", padding: "10px", lineHeight: "1.6" });
		empty.textContent = WKT("historyEmpty");
		WKUI.histList.appendChild(empty);
		return;
	}

	const rows = [];
	for (let i = char.history.length - 1; i >= 0; i--) rows.push({ i, e: char.history[i] });
	for (const r of rows) {
		const { i, e } = r;
		const row = document.createElement("div");
		WKApplyStyle(row, {
			display: "flex",
			alignItems: "center",
			gap: "8px",
			padding: "6px 10px",
			borderBottom: "1px solid #1c2136",
			cursor: "pointer",
			background: i === char.cursor ? "rgba(124,58,237,.22)" : "transparent",
		});
		row.addEventListener("click", () => WKPreviewShow(e.appearance, e.label));

		const chip = document.createElement("span");
		WKApplyStyle(chip, {
			width: "18px",
			height: "18px",
			borderRadius: "4px",
			border: "1px solid #4a5278",
			flex: "none",
			display: "inline-block",
			background: e.chip || "#2a2f45",
		});
		row.appendChild(chip);

		const time = document.createElement("span");
		WKApplyStyle(time, { color: "#8891b8", fontSize: "12px", flex: "none" });
		time.textContent = WKTimeStr(e.t);
		row.appendChild(time);

		const label = document.createElement("span");
		WKApplyStyle(label, { flex: "1", minWidth: "0", color: "#c5cbe8", fontSize: "12px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" });
		label.textContent = e.label;
		label.title = e.label;
		row.appendChild(label);

		if (i === char.cursor) {
			const badge = document.createElement("span");
			WKApplyStyle(badge, {
				flex: "none",
				border: "1px solid #7c3aed",
				borderRadius: "10px",
				padding: "1px 8px",
				fontSize: "11px",
				color: "#c4b5fd",
			});
			badge.textContent = WKT("curBadge");
			row.appendChild(badge);
		}

		const btnPrev = document.createElement("button");
		btnPrev.className = "wk-btn wk-btn-mini";
		WKApplyStyle(btnPrev, {
			background: "#2a2f45",
			border: "1px solid #4a5278",
			color: "#e8eaf6",
			borderRadius: "8px",
			padding: "3px 10px",
			fontSize: "15px",
			cursor: "pointer",
			lineHeight: "1.3",
			flex: "none",
		});
		btnPrev.textContent = WKT("preview");
		btnPrev.addEventListener("click", (ev) => {
			ev.stopPropagation();
			WKPreviewShow(e.appearance, e.label);
		});
		row.appendChild(btnPrev);

		const btnApply = document.createElement("button");
		btnApply.className = "wk-btn wk-btn-mini wk-btn-ok";
		WKApplyStyle(btnApply, {
			background: "#1d4d33",
			border: "1px solid #4ade80",
			color: "#e8eaf6",
			borderRadius: "8px",
			padding: "3px 10px",
			fontSize: "15px",
			cursor: "pointer",
			lineHeight: "1.3",
			flex: "none",
		});
		btnApply.textContent = WKT("apply");
		btnApply.addEventListener("click", (ev) => {
			ev.stopPropagation();
			WKJumpTo(i);
			WKUIRenderAll();
		});
		row.appendChild(btnApply);

		WKUI.histList.appendChild(row);
	}
}

 
function WKUIBuildPalette() {
	if (!WKUI.palHead || !WKUI.palGrid || !WKUI.palAddRow) return;
	WKUI.palHead.innerHTML = "";
	WKUI.palGrid.innerHTML = "";
	WKUI.palAddRow.innerHTML = "";

	const headTitle = document.createElement("div");
	WKApplyStyle(headTitle, { color: "#c4b5fd", fontWeight: "bold", fontSize: "14px" });
	headTitle.textContent = WKT("headPalette");
	WKUI.palHead.appendChild(headTitle);
	const tips = document.createElement("div");
	WKApplyStyle(tips, { color: "#6d7699", fontSize: "11px", marginTop: "3px", lineHeight: "1.5" });
	tips.textContent = WKT("tipPalette");
	WKUI.palHead.appendChild(tips);

	const palette = WKPaletteList();
	if (!palette.length) {
		const empty = document.createElement("div");
		WKApplyStyle(empty, { color: "#6d7699", fontSize: "12px", lineHeight: "1.6" });
		empty.textContent = WKT("paletteEmpty");
		WKUI.palGrid.appendChild(empty);
	} else {
		const grid = document.createElement("div");
		WKApplyStyle(grid, { display: "flex", flexWrap: "wrap", gap: "8px" });
		for (const e of palette) {
			const cell = document.createElement("div");
			WKApplyStyle(cell, {
				width: "84px",
				background: "#1c2136",
				border: "1px solid #2a2f45",
				borderRadius: "8px",
				padding: "6px",
				textAlign: "center",
				cursor: "pointer",
				position: "relative",
			});
			cell.title = WKT("tipPalette");

			const sw = document.createElement("div");
			WKApplyStyle(sw, {
				width: "100%",
				height: "34px",
				borderRadius: "6px",
				background: e.hex,
				border: "1px solid #000000",
				boxSizing: "border-box",
			});
			cell.appendChild(sw);

			const hexText = document.createElement("div");
			WKApplyStyle(hexText, { color: "#c5cbe8", fontSize: "11px", marginTop: "4px", fontFamily: "monospace" });
			hexText.textContent = e.hex;
			cell.appendChild(hexText);

			const del = document.createElement("button");
			WKApplyStyle(del, {
				position: "absolute",
				top: "2px",
				right: "2px",
				background: "rgba(12,14,24,.85)",
				border: "1px solid #4a5278",
				color: "#9aa3c7",
				borderRadius: "4px",
				width: "18px",
				height: "18px",
				fontSize: "11px",
				lineHeight: "1",
				cursor: "pointer",
				padding: "0",
			});
			del.textContent = WKT("remove");
			del.title = WKT("remove");
			del.addEventListener("click", (ev) => {
				ev.stopPropagation();
				if (del.textContent === WKT("remove")) {
					del.textContent = WKT("confirmRemove");
					del.style.color = "#ff5566";
					del.style.width = "auto";
					del.style.padding = "0 4px";
					setTimeout(() => { try { del.textContent = WKT("remove"); del.style.color = "#9aa3c7"; del.style.width = "18px"; } catch (err) { } }, 3000);
					return;
				}
				if (WKPaletteRemove(e.hex)) WKToast(WKT("toastColorRemoved", e.hex));
				WKUIRenderAll();
			});
			cell.appendChild(del);

			cell.addEventListener("click", (ev) => {
				WKSwatchAction(e.hex, ev);
				WKUIRenderAll();
			});
			grid.appendChild(cell);
		}
		WKUI.palGrid.appendChild(grid);
	}

	 
	const input = document.createElement("input");
	WKApplyStyle(input, {
		flex: "1",
		minWidth: "0",
		background: "#1c2136",
		border: "1px solid #4a5278",
		borderRadius: "6px",
		color: "#e8eaf6",
		padding: "6px 8px",
		fontSize: "13px",
	});
	input.placeholder = WKT("addPh");
	WKUI.palAddRow.appendChild(input);
	WKUI.palInput = input;

	const addBtn = document.createElement("button");
	addBtn.className = "wk-btn wk-btn-mini";
	WKApplyStyle(addBtn, {
		background: "#2a2f45",
		border: "1px solid #4a5278",
		color: "#e8eaf6",
		borderRadius: "8px",
		padding: "3px 10px",
		fontSize: "15px",
		cursor: "pointer",
		lineHeight: "1.3",
		flex: "none",
	});
	addBtn.textContent = WKT("btnAdd");
	const doAdd = () => {
		const h = WKNormalizeColor(input.value);
		if (!h) { WKToast(WKT("toastBadColor")); return; }
		const r = WKPaletteAdd(h, "manual");
		if (r.added) WKToast(WKT("toastColorAdded", h));
		else WKToast(WKT("toastRecordedExists"));
		input.value = "";
		WKUIRenderAll();
	};
	addBtn.addEventListener("click", doAdd);
	input.addEventListener("keydown", (ev) => {
		if (ev.key === "Enter") doAdd();
	});
	WKUI.palAddRow.appendChild(addBtn);
}

 
function WKUIBuildStatus() {
	if (!WKUI.statusEl) return;
	const C = WKEditTargetChar();
	const num = C ? C.MemberNumber : WKStore.load().cur;
	const char = num !== null && num !== undefined ? WKCharOf(num) : null;
	let steps = "0/0";
	if (char && char.history.length) steps = (char.cursor + 1) + "/" + char.history.length;
	WKUI.statusEl.textContent = WKT("statusSteps", (char && char.history.length ? char.cursor + 1 : 0), (char ? char.history.length : 0));
}

function WKUIRenderAll() {
	if (!WKUI.win) return;
	try { WKUIBuildHistory(); } catch (e) { WKErr("历史渲染失败", e); }
	try { WKUIBuildPalette(); } catch (e) { WKErr("色板渲染失败", e); }
	try { WKUIBuildStatus(); } catch (e) { WKErr("状态栏渲染失败", e); }
	WKUI.dirty = false;
}

 
function WKUIStartLoop() {
	if (WKUI.tickId) return;
	try {
		WKUI.tickId = setInterval(() => {
			if (!WKTabVisible()) return;
			if (WKUI.dirty && WKUI.open) {
				WKUI.dirty = false;
				try { WKUIRenderAll(); } catch (e) { WKErr("渲染失败", e); }
			}
		}, 500);
	} catch (e) { WKErr("渲染循环启动失败", e); }
}

function WKUIStopLoop() {
	if (WKUI.tickId) {
		try { clearInterval(WKUI.tickId); } catch (e) { }
		WKUI.tickId = null;
	}
}

 
function WKUIArm(kind) {
	WKUI.arm = kind;
	if (WKUI.armTimer) clearTimeout(WKUI.armTimer);
	WKUI.armTimer = setTimeout(() => {
		WKUI.arm = null;
		try { WKUIBuildToolbar(); } catch (e) { }
		try { WKUIRenderAll(); } catch (e) { }
	}, 3000);
}

function WKUIArmIs(kind) { return WKUI.arm === kind; }
function WKUIArmClear() {
	WKUI.arm = null;
	if (WKUI.armTimer) { clearTimeout(WKUI.armTimer); WKUI.armTimer = null; }
}

function WKToast(msg) {
	if (!WKUI.toastEl) {
		const el = document.createElement("div");
		el.id = "wk-toast";
		document.body.appendChild(el);
		WKUI.toastEl = el;
	}
	const el = WKUI.toastEl;
	el.textContent = msg;
	el.style.display = "block";
	el.style.opacity = "1";
	if (WKToastTimer) clearTimeout(WKToastTimer);
	WKToastTimer = setTimeout(() => {
		el.style.opacity = "0";
		setTimeout(() => { el.style.display = "none"; }, 450);
	}, 2600);
}

 

function WardrobeKitOpen() {
	if (WKUI.open) return;
	try {
		WKUI.open = true;
		WKUIBuildWindow();
		WKUIRenderAll();
		WKUIStartLoop();

		 
		WKUI.escHandler = (ev) => {
			if (ev.key !== "Escape") return;
			const ae = document.activeElement;
			if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || (ae.isContentEditable === true))) return;
			WardrobeKitClose();
		};
		document.addEventListener("keydown", WKUI.escHandler, true);

		 
		WKUI.keyHandler = (ev) => {
			if (!(ev.ctrlKey || ev.metaKey)) return;
			const ae = document.activeElement;
			if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || (ae.isContentEditable === true))) return;
			const k = (ev.key || "").toLowerCase();
			if (k === "z") {
				ev.preventDefault();
				ev.stopPropagation();
				if (ev.shiftKey) WKRedo(); else WKUndo();
				WKUIRenderAll();
			} else if (k === "y") {
				ev.preventDefault();
				ev.stopPropagation();
				WKRedo();
				WKUIRenderAll();
			}
		};
		document.addEventListener("keydown", WKUI.keyHandler, true);

		 
		setTimeout(() => {
			try {
				if (!WKTabVisible()) return;
				const C = WKEditTargetChar();
				if (C) WKCaptureStep(C, { label: WKT("stepInit"), explicit: true });
			} catch (e) { WKErr("初始基线采集失败", e); }
		}, 500);

		WKPreviewLayout();
	} catch (e) { WKErr("打开浮窗失败", e); }
}

function WardrobeKitClose() {
	if (!WKUI.open && !WKUI.win) return;
	WKUI.open = false;
	WKUIStopLoop();
	WKPreviewHide();
	if (WKUI.escHandler) {
		document.removeEventListener("keydown", WKUI.escHandler, true);
		WKUI.escHandler = null;
	}
	if (WKUI.keyHandler) {
		document.removeEventListener("keydown", WKUI.keyHandler, true);
		WKUI.keyHandler = null;
	}
	if (WKUI.win) {
		WKUIGeoSave();
		WKUI.win.remove();
		WKUI.win = null;
	}
	WKUI.titlebar = null;
	WKUI.titleEl = null;
	WKUI.toolbar = null;
	WKUI.body = null;
	WKUI.histHead = null;
	WKUI.histList = null;
	WKUI.palHead = null;
	WKUI.palGrid = null;
	WKUI.palAddRow = null;
	WKUI.palInput = null;
	WKUI.statusEl = null;
	WKUI.resizeHandle = null;
	WKUI.minimized = false;
	WKUIArmClear();
	try { WKStore.save(); } catch (e) { }
}

function WKExposeAPI() {
	const g = (typeof globalThis !== "undefined") ? globalThis
		: (typeof window !== "undefined" ? window : null);
	if (!g) return;
	g.WardrobeKitOpen = WardrobeKitOpen;
	g.WardrobeKitClose = WardrobeKitClose;
	g.WardrobeKitToggle = WardrobeKitToggle;
	g.WardrobeKit = {
		Open: WardrobeKitOpen,
		Close: WardrobeKitClose,
		Toggle: WardrobeKitToggle,
		IsOpen: () => WKUI.open,
		Version: () => "1.4.10",
		State: () => WKStore.load(),
		Target: () => {
			const C = WKEditTargetChar();
			return C ? C.MemberNumber : null;
		},
		Undo: WKUndo,
		Redo: WKRedo,
		JumpTo: WKJumpTo,
		History: () => {
			const C = WKEditTargetChar();
			const num = C ? C.MemberNumber : WKStore.load().cur;
			const char = num !== null && num !== undefined ? WKCharOf(num) : null;
			if (!char) return { cursor: 0, steps: [] };
			return {
				cursor: char.cursor,
				steps: char.history.map(e => ({ t: e.t, label: e.label, chip: e.chip })),
			};
		},
		ClearHistory: () => WKClearHistory(),
		AddColor: (hex) => WKPaletteAdd(hex, "manual"),
		RemoveColor: (hex) => WKPaletteRemove(hex),
		RecordCurrent: () => WKRecordCurrentColors(),
		Colors: () => WKPaletteList().map(e => e.hex),
		ClearPalette: () => WKPaletteClear(),
		FillColor: (hex, opts) => WKFillColor(hex, opts),
		PreviewCurrent: () => {
			const C = WKEditTargetChar();
			if (!C) return false;
			const appearance = WKAppearanceBundleOf(C);
			if (appearance === null) return false;
			WKPreviewShow(appearance, WKT("previewNowTitle", WKTargetName()) + " · " + WKT("liveBadge"), { live: true });
			return true;
		},
		PreviewStep: (idx) => {
			const C = WKEditTargetChar();
			const num = C ? C.MemberNumber : WKStore.load().cur;
			const char = num !== null && num !== undefined ? WKCharOf(num) : null;
			if (!char || !Number.isInteger(idx) || idx < 0 || idx >= char.history.length) return false;
			WKPreviewShow(char.history[idx].appearance, char.history[idx].label);
			return true;
		},
		AddUnstableKey: (key) => {
			if (typeof key !== "string" || !key) return false;
			WKExtraVolatileKeys.add(key);
			return true;
		},
		UnstableKeys: () => [...WKVolatilePropKeys, ...WKExtraVolatileKeys],
	};
}

 

function WKMain() {
	if (typeof window !== "undefined" && window.WardrobeKitInstalled) {
		WKLog("已安装，跳过重复加载");
		return;
	}
	const tryRegister = (tries) => {
		if (typeof bcModSdk === "undefined" || !bcModSdk.registerMod) {
			if (tries > 600) {
				WKErr("等待 bcModSdk 超时（60 秒），mod 未能加载");
				return;
			}
			setTimeout(() => tryRegister(tries + 1), 100);
			return;
		}
		try {
			const mod = bcModSdk.registerMod({
				name: "WardrobeKit",
				fullName: "WardrobeKit — 衣柜调色便捷工具",
				version: "1.4.10",
				repository: "",
			}, { allowReplace: true });
			WKStore.load();
			WKUI.lang = WKStorage.get("WardrobeKitLang") === "en" ? "en" : "zh";
			WKExposeAPI();
			WKInstallHooks(mod);
			try { WKInstallPointerShield(); } catch (e) { WKErr("指针护盾安装失败", e); }
			if (typeof window !== "undefined") window.WardrobeKitInstalled = true;

			try { WKUIDotBuild(); } catch (e) { WKErr("小圆点按钮构建失败", e); }

			try {
				if (typeof document !== "undefined" && document.addEventListener) {
					document.addEventListener("visibilitychange", () => {
						if (document.hidden) {
							try { WKStore.save(); } catch (e) { }
						} else {
							WKUI.dirty = true;
						}
					});
				}
			} catch (e) { }

			WKLog("已加载 v1.4.10。聊天室输入 /wk 开关浮窗；控制台可用 WardrobeKitToggle() / window.WardrobeKit 等接口");
		} catch (e) {
			WKErr("注册 mod 失败", e);
		}
	};
	tryRegister(0);
}

if (typeof window !== "undefined" && typeof window.document !== "undefined") {
	

 
	try { WKInstallPointerShield(); } catch (e) { WKErr("指针护盾提前安装失败", e); }
	WKMain();
}

 
if (typeof module !== "undefined" && module.exports) {
	module.exports = {
		WKStore, WKMergeInto, WKDeepClone,
		WKSerializeState, WKExpandCompact, WKParseRaw, WKCompressUTF16, WKDecompressUTF16,
		WKItemCompactOf, WKItemExpandOf,
		WKNormalizeColor, WKHexOf, WKColorPattern,
		WKPaletteAdd, WKPaletteRemove, WKPaletteClear, WKPaletteList,
		WKRecordCurrentColors, WKCurrentColorValues, WKPaletteAutoRecord,
		WKFillColor, WKFillInPicker, WKSwatchAction, WKFocusGroupOf,
		WKCaptureStep, WKQueueCapture, WKUndo, WKRedo, WKJumpTo, WKClearHistory,
		WKApplyEntry, WKRelinkItemColor, WKCharOf, WKCharEnsure, WKTrimHistory,
		WKAppearanceBundleOf, WKHashOf, WKSanitizeBundle,
		WKIsVolatileKey, WKIsVolatileValue, WKVolatilePropKeys, WKVolatilePropPatterns,
		WKVolatileKeepKeys, WKExtraVolatileKeys, WKVolatileSnapshotOf, WKRestoreVolatileKeys,
		WKEditTargetChar, WKWardrobeOpen, WKIsPlayerLike, WKCurrentNum, WKCharObjectOf,
		WKTargetName, WKGameCharDisplayName, WKItemDisplayName, WKGroupDisplayName,
		WKItemWatchStart, WKItemWatchStop, WKItemWatchTick, WKItemWatchRebaseline, WKState,
		WKColorItemName, WKColorChangedIndices, WKLayerLabelOf, WKItemLayerLabel,
		WKGroupNameOf, WKLayerNameOfKey, WKSingleLayerLabelOf,
		WKSetPending, WKTakePending, WKInstallHooks,
		WKPreviewDraw, WKPreviewDrawWithView, WKPreviewShow, WKPreviewHide, WKPreviewLayout,
		WKPreviewStartLoop, WKPreviewStopLoop, WKPreviewSetLive, WKPreviewClampPan,
		WKPreviewSetPoseByName, WKPreviewPoseButtonUpdate, WKPreviewPoseArray, WKPoseEntries,
		WKPreviewPoseMenuBuild, WKPreviewPoseMenuToggle, WKPreviewPoseMenuClose, WKPreviewPoseMenuDocClose,
		WKPreviewBgLoad, WKPreviewBgApply,
		WKUIDotBuild, WKUI, WKToast, WKUIRenderAll, WKUIToolbarRefresh: WKUIBuildToolbar,
		WKUIStartLoop, WKUIStopLoop,
		WKDrag, WKDragPick, WKDragStart, WKDragMove, WKDragEnd, WKHitWK, WKInstallPointerShield,
		WKUIArm, WKUIArmIs, WKUIArmClear,
		WKT, WKText, WKTimeStr, WKTabVisible,
		WardrobeKitOpen, WardrobeKitClose, WardrobeKitToggle,
	};
}
})();

