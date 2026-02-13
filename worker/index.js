const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export default {
	async fetch(request, env) {
		try {
			const url = new URL(request.url);
			const method = request.method.toUpperCase();
			const path = normalizePath(url.pathname);
			const origin = request.headers.get('origin');

			if (method === 'OPTIONS') {
				return new Response(null, {
					status: 204,
					headers: withCorsHeaders({}, origin, env),
				});
			}

			if (path === '/api/health' && method === 'GET') {
				return json({ ok: true, service: 'eso-marker-share' }, 200, origin, env);
			}

			if (path === '/api/auth/login' && method === 'POST') {
				const body = await safeJson(request);
				const username = String(body.username || '').trim();
				const password = String(body.password || '');

				const valid = await validateAdminCredentials(username, password, env);
				if (!valid) {
					return json({ error: 'Ungültige Login-Daten.' }, 401, origin, env);
				}

				const expiresIn = Number(env.JWT_EXPIRES_IN_SECONDS || 3600);
				const token = await signJwt(
					{
						sub: username,
						role: 'admin',
					},
					env.JWT_SECRET,
					expiresIn,
				);

				return json({ token, expiresIn }, 200, origin, env);
			}

			if (path === '/api/groups' && method === 'GET') {
				const groups = (await getJson(env.ESO_Marker_KV, 'groups')) || [];
				return json({ groups }, 200, origin, env);
			}

			if (path === '/api/raids' && method === 'GET') {
				const raids = (await getJson(env.ESO_Marker_KV, 'raids')) || [];
				return json({ raids }, 200, origin, env);
			}

			if (path === '/api/markers' && method === 'GET') {
				const markers = await getAllMarkerSummaries(env.ESO_Marker_KV);
				return json({ markers }, 200, origin, env);
			}

			const groupsRaidsMatch = path.match(/^\/api\/groups\/([^/]+)\/raids$/);
			if (groupsRaidsMatch && method === 'GET') {
				const groupId = decodeURIComponent(groupsRaidsMatch[1]);
				const raids = await getRaidsForGroup(env.ESO_Marker_KV, groupId);
				return json({ raids }, 200, origin, env);
			}

			const groupRaidMarkersMatch = path.match(/^\/api\/groups\/([^/]+)\/raids\/([^/]+)\/markers$/);
			if (groupRaidMarkersMatch && method === 'GET') {
				const groupId = decodeURIComponent(groupRaidMarkersMatch[1]);
				const raidId = decodeURIComponent(groupRaidMarkersMatch[2]);
				const markers = await getMarkerSummariesForPair(env.ESO_Marker_KV, groupId, raidId);
				return json({ markers }, 200, origin, env);
			}

			const markerMatch = path.match(/^\/api\/markers\/([^/]+)$/);
			if (markerMatch && method === 'GET') {
				const markerId = decodeURIComponent(markerMatch[1]);
				const marker = await getJson(env.ESO_Marker_KV, `marker:${markerId}`);
				if (!marker) {
					return json({ error: 'Marker nicht gefunden.' }, 404, origin, env);
				}
				return json({ marker }, 200, origin, env);
			}

			if (markerMatch && method === 'DELETE') {
				const authResult = await requireAdmin(request, env);
				if (!authResult.ok) {
					return json({ error: authResult.error }, 401, origin, env);
				}

				const markerId = decodeURIComponent(markerMatch[1]);
				const marker = await getJson(env.ESO_Marker_KV, `marker:${markerId}`);
				if (!marker) {
					return json({ error: 'Marker nicht gefunden.' }, 404, origin, env);
				}

				await deleteMarkerById(env.ESO_Marker_KV, markerId, marker.groupId, marker.raidId);
				return json({ deleted: true }, 200, origin, env);
			}

			if (path === '/api/markers' && method === 'POST') {
				const authResult = await requireAdmin(request, env);
				if (!authResult.ok) {
					return json({ error: authResult.error }, 401, origin, env);
				}

				const body = await safeJson(request);
				const validationError = validateMarkerInput(body);
				if (validationError) {
					return json({ error: validationError }, 400, origin, env);
				}

				const groups = (await getJson(env.ESO_Marker_KV, 'groups')) || [];
				const groupId = String(body.groupId || '').trim();
				const groupExists = groups.some((item) => item.id === groupId);
				if (!groupExists) {
					return json({ error: 'Ungültige groupId.' }, 400, origin, env);
				}

				const raids = (await getJson(env.ESO_Marker_KV, 'raids')) || [];
				const raidId = String(body.raidId || '').trim();
				const raidExists = raids.some((item) => item.id === raidId);
				if (!raidExists) {
					return json({ error: 'Ungültige raidId.' }, 400, origin, env);
				}

				const groupRaidIdsKey = `group:${groupId}:raidIds`;
				const groupRaidIds = (await getJson(env.ESO_Marker_KV, groupRaidIdsKey)) || [];
				if (!groupRaidIds.includes(raidId)) {
					groupRaidIds.push(raidId);
					await env.ESO_Marker_KV.put(groupRaidIdsKey, JSON.stringify(groupRaidIds));
				}

				const latestVersionKey = `pair:${groupId}:${raidId}:latestVersion`;
				const markerIdsKey = `pair:${groupId}:${raidId}:markerIds`;
				const latestVersionRaw = await env.ESO_Marker_KV.get(latestVersionKey);
				const latestVersion = Number(latestVersionRaw || 0);
				const newVersion = latestVersion + 1;

				const markerId = crypto.randomUUID();
				const marker = {
					id: markerId,
					groupId,
					raidId,
					version: newVersion,
					markerString: String(body.markerString),
					createdAt: new Date().toISOString(),
					createdBy: authResult.payload.sub,
				};

				await env.ESO_Marker_KV.put(`marker:${markerId}`, JSON.stringify(marker));
				await env.ESO_Marker_KV.put(latestVersionKey, String(newVersion));

				const markerIds = (await getJson(env.ESO_Marker_KV, markerIdsKey)) || [];
				markerIds.unshift(markerId);
				await env.ESO_Marker_KV.put(markerIdsKey, JSON.stringify(markerIds));

				return json({ marker }, 201, origin, env);
			}

			if (path === '/api/groups' && method === 'POST') {
				const authResult = await requireAdmin(request, env);
				if (!authResult.ok) {
					return json({ error: authResult.error }, 401, origin, env);
				}

				const body = await safeJson(request);
				const name = String(body.name || '').trim();
				if (!name) {
					return json({ error: 'Feld name ist erforderlich.' }, 400, origin, env);
				}

				const groups = (await getJson(env.ESO_Marker_KV, 'groups')) || [];
				const existing = groups.find((item) => normalizeName(item.name) === normalizeName(name));
				if (existing) {
					return json({ group: existing, created: false }, 200, origin, env);
				}

				const groupId = generateEntityId(
					'grp',
					name,
					groups.map((item) => item.id),
				);
				const group = { id: groupId, name };
				groups.push(group);
				await env.ESO_Marker_KV.put('groups', JSON.stringify(groups));

				return json({ group, created: true }, 201, origin, env);
			}

			const groupDeleteMatch = path.match(/^\/api\/groups\/([^/]+)$/);
			if (groupDeleteMatch && method === 'DELETE') {
				const authResult = await requireAdmin(request, env);
				if (!authResult.ok) {
					return json({ error: authResult.error }, 401, origin, env);
				}

				const groupId = decodeURIComponent(groupDeleteMatch[1]);
				const groups = (await getJson(env.ESO_Marker_KV, 'groups')) || [];
				if (!groups.some((group) => group.id === groupId)) {
					return json({ error: 'Raidgruppe nicht gefunden.' }, 404, origin, env);
				}

				const groupRaidIdsKey = `group:${groupId}:raidIds`;
				const raidIds = (await getJson(env.ESO_Marker_KV, groupRaidIdsKey)) || [];
				for (const raidId of raidIds) {
					await deletePairData(env.ESO_Marker_KV, groupId, raidId);
				}

				const nextGroups = groups.filter((group) => group.id !== groupId);
				await env.ESO_Marker_KV.put('groups', JSON.stringify(nextGroups));
				await env.ESO_Marker_KV.delete(groupRaidIdsKey);

				return json({ deleted: true }, 200, origin, env);
			}

			if (path === '/api/raids' && method === 'POST') {
				const authResult = await requireAdmin(request, env);
				if (!authResult.ok) {
					return json({ error: authResult.error }, 401, origin, env);
				}

				const body = await safeJson(request);
				const name = String(body.name || '').trim();
				if (!name) {
					return json({ error: 'Feld name ist erforderlich.' }, 400, origin, env);
				}

				const raids = (await getJson(env.ESO_Marker_KV, 'raids')) || [];
				const existing = raids.find((item) => normalizeName(item.name) === normalizeName(name));
				if (existing) {
					return json({ raid: existing, created: false }, 200, origin, env);
				}

				const raidId = generateEntityId(
					'raid',
					name,
					raids.map((item) => item.id),
				);
				const raid = { id: raidId, name };
				raids.push(raid);
				await env.ESO_Marker_KV.put('raids', JSON.stringify(raids));

				return json({ raid, created: true }, 201, origin, env);
			}

			const raidDeleteMatch = path.match(/^\/api\/raids\/([^/]+)$/);
			if (raidDeleteMatch && method === 'DELETE') {
				const authResult = await requireAdmin(request, env);
				if (!authResult.ok) {
					return json({ error: authResult.error }, 401, origin, env);
				}

				const raidId = decodeURIComponent(raidDeleteMatch[1]);
				const raids = (await getJson(env.ESO_Marker_KV, 'raids')) || [];
				if (!raids.some((raid) => raid.id === raidId)) {
					return json({ error: 'Raid nicht gefunden.' }, 404, origin, env);
				}

				const groups = (await getJson(env.ESO_Marker_KV, 'groups')) || [];
				for (const group of groups) {
					const groupRaidIdsKey = `group:${group.id}:raidIds`;
					const raidIds = (await getJson(env.ESO_Marker_KV, groupRaidIdsKey)) || [];
					if (!raidIds.includes(raidId)) continue;

					await deletePairData(env.ESO_Marker_KV, group.id, raidId);
					const nextRaidIds = raidIds.filter((id) => id !== raidId);
					if (nextRaidIds.length) {
						await env.ESO_Marker_KV.put(groupRaidIdsKey, JSON.stringify(nextRaidIds));
					} else {
						await env.ESO_Marker_KV.delete(groupRaidIdsKey);
					}
				}

				const nextRaids = raids.filter((raid) => raid.id !== raidId);
				await env.ESO_Marker_KV.put('raids', JSON.stringify(nextRaids));

				return json({ deleted: true }, 200, origin, env);
			}

			return json({ error: 'Route nicht gefunden.' }, 404, origin, env);
		} catch (error) {
			return json(
				{
					error: 'Interner Serverfehler.',
					details: error instanceof Error ? error.message : String(error),
				},
				500,
				request.headers.get('origin'),
				env,
			);
		}
	},
};

function normalizePath(pathname) {
	if (!pathname) return '/';
	if (pathname.length > 1 && pathname.endsWith('/')) {
		return pathname.slice(0, -1);
	}
	return pathname;
}

function json(payload, status, origin, env) {
	return new Response(JSON.stringify(payload, null, 2), {
		status,
		headers: withCorsHeaders(JSON_HEADERS, origin, env),
	});
}

function withCorsHeaders(baseHeaders, origin, env) {
	const headers = new Headers(baseHeaders);
	const allowedOrigin = resolveAllowedOrigin(origin, env);
	if (allowedOrigin) {
		headers.set('access-control-allow-origin', allowedOrigin);
		headers.set('vary', 'origin');
	}
	headers.set('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
	headers.set('access-control-allow-headers', 'content-type,authorization');
	return headers;
}

function resolveAllowedOrigin(origin, env) {
	const allowedRaw = String(env.ALLOWED_ORIGINS || '*').trim();
	if (allowedRaw === '*') return '*';
	if (!origin) return '';
	const allowed = allowedRaw
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean);
	return allowed.includes(origin) ? origin : '';
}

async function safeJson(request) {
	const contentType = request.headers.get('content-type') || '';
	if (!contentType.toLowerCase().includes('application/json')) {
		throw new Error('Ungültiger Content-Type. Erwartet wird application/json.');
	}
	return request.json();
}

function validateMarkerInput(body) {
	const required = ['groupId', 'raidId', 'markerString'];
	for (const key of required) {
		const value = body[key];
		if (typeof value !== 'string' || !value.trim()) {
			return `Feld ${key} ist erforderlich.`;
		}
	}

	return '';
}

function normalizeName(value) {
	return String(value || '')
		.trim()
		.toLowerCase();
}

function generateEntityId(prefix, name, existingIds) {
	const usedIds = new Set(existingIds || []);
	const base = slugify(name) || prefix;
	let candidate = `${prefix}-${base}`;

	if (!usedIds.has(candidate)) {
		return candidate;
	}

	let counter = 2;
	while (usedIds.has(`${candidate}-${counter}`)) {
		counter += 1;
	}

	return `${candidate}-${counter}`;
}

function slugify(value) {
	return String(value || '')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
}

async function getJson(kv, key) {
	const raw = await kv.get(key);
	if (!raw) return null;
	return JSON.parse(raw);
}

async function getRaidsForGroup(kv, groupId) {
	const raidIds = await getJson(kv, `group:${groupId}:raidIds`);
	if (!Array.isArray(raidIds)) {
		return [];
	}

	const allRaids = (await getJson(kv, 'raids')) || [];
	const raidMap = new Map(allRaids.map((raid) => [raid.id, raid]));
	return raidIds.map((raidId) => raidMap.get(raidId)).filter(Boolean);
}

async function getMarkerSummariesForPair(kv, groupId, raidId) {
	const markerIds = (await getJson(kv, `pair:${groupId}:${raidId}:markerIds`)) || [];

	const markers = await Promise.all(
		markerIds.map(async (id) => {
			const marker = await getJson(kv, `marker:${id}`);
			if (!marker) return null;
			if (marker.groupId !== groupId || marker.raidId !== raidId) return null;
			return {
				id: marker.id,
				groupId: marker.groupId,
				raidId: marker.raidId,
				version: marker.version,
				createdAt: marker.createdAt,
			};
		}),
	);

	return markers.filter(Boolean);
}

async function getAllMarkerSummaries(kv) {
	const keyInfos = [];
	let cursor;

	do {
		const result = await kv.list({ cursor, prefix: 'marker:' });
		keyInfos.push(...result.keys);
		cursor = result.list_complete ? undefined : result.cursor;
	} while (cursor);

	const markers = await Promise.all(
		keyInfos.map(async (keyInfo) => {
			const marker = await getJson(kv, keyInfo.name);
			if (!marker) return null;
			return {
				id: marker.id,
				groupId: marker.groupId,
				raidId: marker.raidId,
				version: marker.version,
				createdAt: marker.createdAt,
			};
		}),
	);

	return markers
		.filter(Boolean)
		.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

async function deleteMarkerById(kv, markerId, groupId, raidId) {
	await kv.delete(`marker:${markerId}`);

	const markerIdsKey = `pair:${groupId}:${raidId}:markerIds`;
	const latestVersionKey = `pair:${groupId}:${raidId}:latestVersion`;
	const markerIds = (await getJson(kv, markerIdsKey)) || [];
	const nextMarkerIds = markerIds.filter((id) => id !== markerId);

	if (nextMarkerIds.length) {
		await kv.put(markerIdsKey, JSON.stringify(nextMarkerIds));
		const nextVersions = await Promise.all(
			nextMarkerIds.map(async (id) => {
				const marker = await getJson(kv, `marker:${id}`);
				return marker && Number.isFinite(marker.version) ? marker.version : 0;
			}),
		);
		const maxVersion = Math.max(...nextVersions, 0);
		await kv.put(latestVersionKey, String(maxVersion));
	} else {
		await kv.delete(markerIdsKey);
		await kv.delete(latestVersionKey);
	}
}

async function deletePairData(kv, groupId, raidId) {
	const markerIdsKey = `pair:${groupId}:${raidId}:markerIds`;
	const latestVersionKey = `pair:${groupId}:${raidId}:latestVersion`;
	const markerIds = (await getJson(kv, markerIdsKey)) || [];

	for (const markerId of markerIds) {
		await kv.delete(`marker:${markerId}`);
	}

	await kv.delete(markerIdsKey);
	await kv.delete(latestVersionKey);
}

async function requireAdmin(request, env) {
	const authorization = request.headers.get('authorization') || '';
	if (!authorization.startsWith('Bearer ')) {
		return { ok: false, error: 'Fehlendes Bearer-Token.' };
	}

	const token = authorization.slice('Bearer '.length).trim();
	const payload = await verifyJwt(token, env.JWT_SECRET);
	if (!payload) {
		return { ok: false, error: 'Ungültiges oder abgelaufenes Token.' };
	}

	if (payload.role !== 'admin') {
		return { ok: false, error: 'Unzureichende Berechtigung.' };
	}

	return { ok: true, payload };
}

async function validateAdminCredentials(username, password, env) {
	const configuredUser = String(env.ADMIN_USERNAME || '');
	if (!configuredUser || username !== configuredUser) {
		return false;
	}

	const configuredPassword = String(env.ADMIN_PASSWORD || '');
	const configuredPasswordHash = String(env.ADMIN_PASSWORD_HASH_SHA256 || '');

	if (configuredPasswordHash) {
		const incomingHash = await sha256Hex(password);
		return timingSafeEqual(incomingHash, configuredPasswordHash.toLowerCase());
	}

	return timingSafeEqual(password, configuredPassword);
}

function timingSafeEqual(a, b) {
	const valueA = String(a || '');
	const valueB = String(b || '');
	let mismatch = valueA.length === valueB.length ? 0 : 1;
	const max = Math.max(valueA.length, valueB.length);
	for (let i = 0; i < max; i += 1) {
		const charA = valueA.charCodeAt(i) || 0;
		const charB = valueB.charCodeAt(i) || 0;
		mismatch |= charA ^ charB;
	}
	return mismatch === 0;
}

async function sha256Hex(input) {
	const bytes = new TextEncoder().encode(String(input));
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	const view = new Uint8Array(digest);
	return Array.from(view, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function signJwt(payload, secret, expiresInSeconds) {
	if (!secret) throw new Error('JWT_SECRET fehlt.');

	const now = Math.floor(Date.now() / 1000);
	const fullPayload = {
		...payload,
		iat: now,
		exp: now + Number(expiresInSeconds || 3600),
	};

	const headerEncoded = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
	const payloadEncoded = base64UrlEncode(JSON.stringify(fullPayload));
	const data = `${headerEncoded}.${payloadEncoded}`;
	const signature = await hmacSha256(data, secret);

	return `${data}.${signature}`;
}

async function verifyJwt(token, secret) {
	if (!secret || typeof token !== 'string') return null;

	const parts = token.split('.');
	if (parts.length !== 3) return null;

	const [headerEncoded, payloadEncoded, signature] = parts;
	const data = `${headerEncoded}.${payloadEncoded}`;
	const expectedSignature = await hmacSha256(data, secret);
	if (!timingSafeEqual(signature, expectedSignature)) {
		return null;
	}

	let header;
	let payload;
	try {
		header = JSON.parse(base64UrlDecode(headerEncoded));
		payload = JSON.parse(base64UrlDecode(payloadEncoded));
	} catch {
		return null;
	}

	if (header.alg !== 'HS256' || header.typ !== 'JWT') {
		return null;
	}

	const now = Math.floor(Date.now() / 1000);
	if (typeof payload.exp !== 'number' || payload.exp <= now) {
		return null;
	}

	return payload;
}

async function hmacSha256(data, secret) {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign'],
	);

	const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
	return base64UrlEncodeBytes(new Uint8Array(signature));
}

function base64UrlEncode(input) {
	const bytes = new TextEncoder().encode(input);
	return base64UrlEncodeBytes(bytes);
}

function base64UrlEncodeBytes(bytes) {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(input) {
	const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
	const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}
