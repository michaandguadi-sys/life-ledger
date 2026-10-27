/* Life Ledger device runtime.
   Provides window.claude.use('db' | 'user' | 'sample' | 'downloads') on a plain web page:
   db -> localStorage on this device, sample -> Anthropic Messages API with the user's own key,
   user -> a fixed local id, downloads -> share sheet or file download. */
(() => {
	const P = 'll:';
	const UID = 'local';
	const BASE = 'data/users/' + UID;
	const MODELS = { opus: 'claude-opus-5-5', sonnet: 'claude-sonnet-5-5', haiku: 'claude-haiku-5-5' };
	const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

	const read = (k, d = null) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } };
	const write = (k, v) => localStorage.setItem(k, JSON.stringify(v));
	const err = (code, message, extra) => Object.assign(new Error(message || code), { code }, extra || {});

	// ---------- settings ----------
	const settings = {
		key() {
			const own = read(P + 'apiKey', '');
			if (own) return { key: own, from: 'own' };
			const aves = read('apiKey', ''); // Aves de Alem shares this origin and stores its key here
			return typeof aves === 'string' && aves.startsWith('sk-') ? { key: aves, from: 'aves' } : { key: '', from: '' };
		},
		setKey(v) { v ? write(P + 'apiKey', v) : localStorage.removeItem(P + 'apiKey'); },
		model() { return read(P + 'model', 'opus'); },
		setModel(v) { write(P + 'model', MODELS[v] ? v : 'opus'); },
	};

	// ---------- db ----------
	const docListeners = new Map();
	const collListeners = new Map();
	const parentOf = (path) => path.slice(0, path.lastIndexOf('/'));
	const snap = (path) => { const v = read(P + path); return { id: path.split('/').pop(), exists: v != null, data: () => v }; };

	function listColl(path, field, dir, limit) {
		const pre = P + path + '/';
		const docs = [];
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i);
			if (!k || !k.startsWith(pre) || k.slice(pre.length).includes('/')) continue;
			docs.push(snap(k.slice(P.length)));
		}
		if (field) docs.sort((a, b) => {
			const x = (a.data() || {})[field], y = (b.data() || {})[field];
			return (x > y ? 1 : x < y ? -1 : 0) * (dir === 'desc' ? -1 : 1);
		});
		return { docs: limit ? docs.slice(0, limit) : docs };
	}

	function notify(path) {
		for (const cb of docListeners.get(path) || []) cb();
		for (const cb of collListeners.get(parentOf(path)) || []) cb();
	}

	function listen(map, path, fn) {
		if (!map.has(path)) map.set(path, new Set());
		map.get(path).add(fn);
		queueMicrotask(fn);
		return () => map.get(path).delete(fn);
	}

	function setDoc(path, data) {
		try { write(P + path, data); } catch (e) { throw err('quota_exceeded', 'Storage is full'); }
		notify(path);
	}

	function docRef(path) {
		return {
			id: path.split('/').pop(),
			path,
			async get() { return snap(path); },
			async set(data) { setDoc(path, JSON.parse(JSON.stringify(data))); },
			async delete() { localStorage.removeItem(P + path); notify(path); },
			onSnapshot(cb, onErr) {
				return listen(docListeners, path, () => { try { cb(snap(path)); } catch (e) { onErr && onErr(e); } });
			},
			collection(name) { return collRef(path + '/' + name); },
		};
	}

	function collRef(path, field, dir, limit) {
		return {
			path,
			doc(id) { return docRef(path + '/' + id); },
			orderBy(f, d = 'asc') { return collRef(path, f, d, limit); },
			limit(n) { return collRef(path, field, dir, n); },
			async get() { return listColl(path, field, dir, limit); },
			onSnapshot(cb, onErr) {
				return listen(collListeners, path, () => { try { cb(listColl(path, field, dir, limit)); } catch (e) { onErr && onErr(e); } });
			},
		};
	}

	// Other tabs of the app on this device write to the same storage.
	window.addEventListener('storage', (e) => { if (e.key && e.key.startsWith(P)) notify(e.key.slice(P.length)); });

	const db = { doc: docRef, collection: collRef };

	// ---------- import / setup code ----------
	function decodeSetup(text) {
		text = (text || '').trim();
		if (!text) throw err('bad_setup', 'Empty');
		if (text.startsWith('{')) return JSON.parse(text);
		const code = text.replace(/^.*#?setup=/, '').replace(/^LL1:/, '').replace(/\s+/g, '');
		if (!/^[A-Za-z0-9_\-+/]+=*$/.test(code)) throw err('bad_setup', 'Not a setup code');
		const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
		const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
		return JSON.parse(new TextDecoder().decode(bytes));
	}

	function importData(obj) {
		if (!obj || typeof obj !== 'object') throw err('bad_setup', 'Not a Life Ledger backup');
		let n = 0;
		if (obj.profile && typeof obj.profile === 'object') { setDoc(BASE + '/profile', obj.profile); n++; }
		const chat = Array.isArray(obj.chat) ? obj.chat : obj.chat && obj.chat.turns;
		if (Array.isArray(chat)) { setDoc(BASE + '/chat', { turns: chat }); n++; }
		for (const [id, d] of Object.entries(obj.days || {})) { setDoc(BASE + '/profile/days/' + id, d); n++; }
		for (const [id, w] of Object.entries(obj.weeks || {})) { setDoc(BASE + '/profile/weeks/' + id, w); n++; }
		if (!n) throw err('bad_setup', 'Nothing to import');
		return n;
	}

	function hasData() { return read(P + BASE + '/profile') != null; }

	// A link ending in #setup=<code> loads a profile into this browser.
	if (location.hash.startsWith('#setup=')) {
		try {
			const obj = decodeSetup(location.hash.slice(1));
			if (!hasData() || confirm('Replace the profile and mentor chat on this device with the one from this link?')) {
				importData(obj);
				sessionStorage.setItem(P + 'flash', 'Profile loaded.');
			}
		} catch (_) {
			sessionStorage.setItem(P + 'flash', 'That setup link is broken.');
		}
		history.replaceState(null, '', location.pathname + '#me');
	}

	// ---------- sample (Claude) ----------
	async function imageBlock(file) {
		if (!file || !/^image\//.test(file.type || 'image/')) throw err('image_rejected');
		let bmp;
		try { bmp = await createImageBitmap(file); } catch (_) { throw err('image_rejected'); }
		const scale = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
		const c = document.createElement('canvas');
		c.width = Math.round(bmp.width * scale);
		c.height = Math.round(bmp.height * scale);
		c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
		const data = c.toDataURL('image/jpeg', 0.88).split(',')[1];
		return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } };
	}

	function tierConfig(tier) {
		if (tier === 'quick') return { model: MODELS.haiku, effort: 'low' };
		const model = MODELS[settings.model()] || MODELS.opus;
		return { model, effort: tier === 'complex' ? 'high' : 'medium' };
	}

	let fallbacksOk = true;

	async function callClaude(messages, opts) {
		const { key } = settings.key();
		if (!key) throw err('no_key', 'No API key');
		const { model, effort } = tierConfig(opts.modelTier);
		const useFallback = fallbacksOk && model !== MODELS.haiku;
		const body = { model, max_tokens: 16000, stream: true, messages, output_config: { effort } };
		const headers = {
			'content-type': 'application/json',
			'x-api-key': key,
			'anthropic-version': '2023-06-01',
			'anthropic-dangerous-direct-browser-access': 'true',
		};
		if (useFallback) { body.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }
		let res;
		try {
			res = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body), signal: opts.signal });
		} catch (e) {
			if (e && e.name === 'AbortError') throw err('cancelled', 'Stopped', { text: '' });
			if (useFallback) { fallbacksOk = false; return callClaude(messages, opts); }
			throw err('network', 'No connection');
		}
		if (!res.ok) {
			let msg = '';
			try { msg = ((await res.json()).error || {}).message || ''; } catch (_) {}
			if (res.status === 400 && useFallback && /fallback|beta/i.test(msg)) { fallbacksOk = false; return callClaude(messages, opts); }
			if (res.status === 401 || res.status === 403) throw err('auth', msg);
			if (res.status === 429) throw err('rate_limited', msg);
			if (res.status >= 500) throw err('overloaded', msg);
			if (/image/i.test(msg)) throw err('image_rejected', msg);
			throw err('bad_request', msg);
		}
		return readStream(res, opts);
	}

	async function readStream(res, opts) {
		const reader = res.body.getReader();
		const dec = new TextDecoder();
		let buf = '', text = '', stop = null;
		const handle = (ev) => {
			if (ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'fallback') text = '';
			else if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
				text += ev.delta.text;
				opts.onText && opts.onText({ text });
			} else if (ev.type === 'message_delta' && ev.delta) stop = ev.delta.stop_reason || stop;
			else if (ev.type === 'error') throw err(/overload/i.test((ev.error || {}).type || '') ? 'overloaded' : 'bad_request', (ev.error || {}).message);
		};
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buf += dec.decode(value, { stream: true });
				let i;
				while ((i = buf.indexOf('\n\n')) >= 0) {
					const chunk = buf.slice(0, i);
					buf = buf.slice(i + 2);
					for (const line of chunk.split('\n')) if (line.startsWith('data:')) handle(JSON.parse(line.slice(5)));
				}
			}
		} catch (e) {
			if (e && e.name === 'AbortError') throw err('cancelled', 'Stopped', { text });
			if (e && e.code) throw e;
			throw err('network', 'Connection lost', { text });
		}
		if (stop === 'refusal') throw err('refused', 'Declined', { text: '' });
		return { text, stopReason: stop };
	}

	async function toMessages(prompt, images) {
		let msgs = typeof prompt === 'string'
			? [{ role: 'user', content: prompt }]
			: prompt.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
		msgs = msgs.filter((m) => typeof m.content !== 'string' || m.content.trim());
		if (!msgs.length || msgs[msgs.length - 1].role !== 'user') throw err('bad_request', 'The last message must be yours');
		if (images && images.length) {
			const last = msgs[msgs.length - 1];
			const blocks = await Promise.all([...images].map(imageBlock));
			last.content = [...blocks, ...(typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : last.content)];
		}
		return msgs;
	}

	async function sample(prompt, opts = {}) {
		return callClaude(await toMessages(prompt, opts.images), opts);
	}

	sample.json = async (prompt, opts = {}) => {
		const suffix = '\n\nAnswer with one JSON object only: no prose, no code fences.';
		const p = typeof prompt === 'string' ? prompt + suffix : prompt;
		const { text } = await sample(p, opts);
		const s = text.replace(/```(?:json)?/g, '');
		const a = s.indexOf('{'), b = s.lastIndexOf('}');
		try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { throw err('invalid_json', 'Bad JSON'); }
	};

	sample.limits = async () => ({ images: { mediaTypes: IMAGE_TYPES, maxCount: 10 } });

	// ---------- downloads ----------
	const downloads = {
		async save({ filename, data }) {
			const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/json' });
			const file = new File([blob], filename, { type: blob.type || 'application/json' });
			if (navigator.canShare && navigator.canShare({ files: [file] })) {
				try { await navigator.share({ files: [file], title: filename }); return { status: 'saved' }; } catch (e) {
					if (e && e.name === 'AbortError') throw err('declined');
				}
			}
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = filename;
			document.body.append(a);
			a.click();
			setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
			return { status: 'saved' };
		},
	};

	const user = { async id() { return UID; } };
	const caps = { db, user, sample, downloads };
	window.claude = Object.freeze({ use: async (name) => caps[name] || null });
	window.LL = { settings, importData, decodeSetup, hasData, MODELS };

	if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
	if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
