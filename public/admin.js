const API_BASE = window.APP_CONFIG?.API_BASE || '';
const DELETE_ICON_SVG = '×';

if (!API_BASE) {
	throw new Error('API_BASE missing. Please configure config.js.');
}
const TOKEN_KEY = 'eso_admin_token';

const loginPanel = document.getElementById('loginPanel');
const adminPanel = document.getElementById('adminPanel');
const adminPanelRaids = document.getElementById('adminPanelRaids');
const adminPanelMarkers = document.getElementById('adminPanelMarkers');
const adminRoleStatus = document.getElementById('adminRoleStatus');
const logoutBtn = document.getElementById('logoutBtn');

const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const loginStatus = document.getElementById('loginStatus');

const newGroupNameInput = document.getElementById('newGroupName');
const createGroupBtn = document.getElementById('createGroupBtn');
const groupStatus = document.getElementById('groupStatus');
const groupList = document.getElementById('groupList');

const newRaidNameInput = document.getElementById('newRaidName');
const createRaidBtn = document.getElementById('createRaidBtn');
const raidStatus = document.getElementById('raidStatus');
const raidList = document.getElementById('raidList');

const groupSelect = document.getElementById('groupSelect');
const raidSelect = document.getElementById('raidSelect');
const markerTypeSelect = document.getElementById('markerType');
const markerStringInput = document.getElementById('markerString');
const saveBtn = document.getElementById('saveBtn');
const saveStatus = document.getElementById('saveStatus');
const markerTable = document.getElementById('markerTable');

const adminPanelMaintainers = document.getElementById('adminPanelMaintainers');
const newMaintainerUsernameInput = document.getElementById('newMaintainerUsername');
const newMaintainerPasswordInput = document.getElementById('newMaintainerPassword');
const createMaintainerBtn = document.getElementById('createMaintainerBtn');
const maintainerStatus = document.getElementById('maintainerStatus');
const maintainerUsernameSelect = document.getElementById('maintainerUsernameSelect');
const maintainerGroupSelect = document.getElementById('maintainerGroupSelect');
const updateMaintainerGroupsBtn = document.getElementById('updateMaintainerGroupsBtn');
const maintainerList = document.getElementById('maintainerList');

let groupsCache = [];
let raidsCache = [];
let maintainersCache = [];
let currentUserRole = null;
let currentUsername = null;
let currentMaintainerGroupIds = [];

async function init() {
	const token = localStorage.getItem(TOKEN_KEY);
	if (!token) {
		return;
	}

	const payload = parseJwtPayload(token);
	if (!payload?.role || !payload?.sub) {
		showLogin('Invalid session token.');
		return;
	}

	currentUserRole = payload.role;
	currentUsername = payload.sub;

	if (currentUserRole === 'maintainer') {
		try {
			await loadMaintainerMe();
		} catch (error) {
			showLogin('Session expired. Please log in again.');
			return;
		}
	}

	showAdmin();
	await loadSelectionData();
}

init();

logoutBtn?.addEventListener('click', () => {
	logout();
});

groupSelect.addEventListener('change', () => {
	loadMarkerList();
});

raidSelect.addEventListener('change', () => {
	loadMarkerList();
});

loginBtn.addEventListener('click', async () => {
	loginStatus.textContent = 'Logging in...';

	try {
		const response = await fetch(`${API_BASE}/api/auth/login`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				username: usernameInput.value.trim(),
				password: passwordInput.value,
			}),
		});

		const data = await response.json();
		if (!response.ok) {
			throw new Error(data.error || `HTTP ${response.status}`);
		}

		localStorage.setItem(TOKEN_KEY, data.token);
		const payload = parseJwtPayload(data.token);
		currentUserRole = payload?.role || null;
		currentUsername = payload?.sub || null;

		if (currentUserRole === 'maintainer') {
			await loadMaintainerMe();
		}

		loginStatus.textContent = 'Login successful.';
		showAdmin();
		await loadSelectionData();
	} catch (error) {
		loginStatus.textContent = `Login failed: ${error.message}`;
	}
});

createGroupBtn.addEventListener('click', async () => {
	groupStatus.textContent = 'Saving...';

	try {
		const activeToken = getRequiredToken();
		const response = await fetch(`${API_BASE}/api/groups`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${activeToken}`,
			},
			body: JSON.stringify({ name: newGroupNameInput.value.trim() }),
		});

		const data = await response.json();
		if (response.status === 401) {
			showLogin('Session expired. Please log in again.');
			throw new Error(data.error || 'Session expired.');
		}
		if (!response.ok) {
			throw new Error(data.error || `HTTP ${response.status}`);
		}

		groupStatus.textContent = data.created
			? `Group created: ${data.group.name}`
			: `Group already exists: ${data.group.name}`;
		newGroupNameInput.value = '';
		await loadSelectionData();
	} catch (error) {
		groupStatus.textContent = `Error: ${error.message}`;
	}
});

createMaintainerBtn.addEventListener('click', async () => {
	maintainerStatus.textContent = 'Saving...';

	const username = newMaintainerUsernameInput.value.trim();
	const password = newMaintainerPasswordInput.value;
	if (!username || !password) {
		maintainerStatus.textContent = 'Username and password are required.';
		return;
	}

	try {
		const activeToken = getRequiredToken();
		const response = await fetch(`${API_BASE}/api/maintainers`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${activeToken}`,
			},
			body: JSON.stringify({ username, password }),
		});

		const data = await response.json();
		if (response.status === 401) {
			showLogin('Session expired. Please log in again.');
			throw new Error(data.error || 'Session expired.');
		}
		if (!response.ok) {
			throw new Error(data.error || `HTTP ${response.status}`);
		}

		maintainerStatus.textContent = data.created
			? `Maintainer created: ${data.maintainer.username}`
			: `Maintainer already exists: ${data.maintainer.username}`;
		newMaintainerUsernameInput.value = '';
		newMaintainerPasswordInput.value = '';
		await loadMaintainerList();
	} catch (error) {
		maintainerStatus.textContent = `Error: ${error.message}`;
	}
});

maintainerUsernameSelect.addEventListener('change', () => {
	updateMaintainerGroupSelection();
});

updateMaintainerGroupsBtn.addEventListener('click', async () => {
	const username = maintainerUsernameSelect.value;
	if (!username) {
		maintainerStatus.textContent = 'Select a maintainer to update.';
		return;
	}

	const groupIds = Array.from(maintainerGroupSelect.selectedOptions).map((option) => option.value);

	maintainerStatus.textContent = 'Saving...';

	try {
		const activeToken = getRequiredToken();
		const response = await fetch(
			`${API_BASE}/api/maintainers/${encodeURIComponent(username)}/groups`,
			{
				method: 'PUT',
				headers: {
					'content-type': 'application/json',
					authorization: `Bearer ${activeToken}`,
				},
				body: JSON.stringify({ groupIds }),
			},
		);

		const data = await response.json();
		if (response.status === 401) {
			showLogin('Session expired. Please log in again.');
			throw new Error(data.error || 'Session expired.');
		}
		if (!response.ok) {
			throw new Error(data.error || `HTTP ${response.status}`);
		}

		maintainerStatus.textContent = `Assignments updated for ${username}`;
		await loadMaintainerList();
	} catch (error) {
		maintainerStatus.textContent = `Error: ${error.message}`;
	}
});

createRaidBtn.addEventListener('click', async () => {
	raidStatus.textContent = 'Saving...';

	try {
		const activeToken = getRequiredToken();
		const response = await fetch(`${API_BASE}/api/raids`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${activeToken}`,
			},
			body: JSON.stringify({ name: newRaidNameInput.value.trim() }),
		});

		const data = await response.json();
		if (response.status === 401) {
			showLogin('Session expired. Please log in again.');
			throw new Error(data.error || 'Session expired.');
		}
		if (!response.ok) {
			throw new Error(data.error || `HTTP ${response.status}`);
		}

		raidStatus.textContent = data.created
			? `Raid created: ${data.raid.name}`
			: `Raid already exists: ${data.raid.name}`;
		newRaidNameInput.value = '';
		await loadSelectionData();
	} catch (error) {
		raidStatus.textContent = `Error: ${error.message}`;
	}
});

saveBtn.addEventListener('click', async () => {
	const markerString = markerStringInput.value;

	const payload = {
		groupId: groupSelect.value,
		raidId: raidSelect.value,
		type: markerTypeSelect.value,
		markerString,
	};

	if (!payload.groupId || !payload.raidId) {
		saveStatus.textContent = 'Please select a group and a raid first.';
		return;
	}

	if (!payload.markerString.trim()) {
		saveStatus.textContent = 'Marker string is required.';
		return;
	}

	if (!payload.type) {
		saveStatus.textContent = 'Type is required.';
		return;
	}

	saveStatus.textContent = 'Saving...';

	try {
		const activeToken = getRequiredToken();

		const response = await fetch(`${API_BASE}/api/markers`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${activeToken}`,
			},
			body: JSON.stringify(payload),
		});

		const data = await response.json();
		if (response.status === 401) {
			showLogin('Session expired. Please log in again.');
			throw new Error(data.error || 'Session expired.');
		}
		if (!response.ok) {
			throw new Error(data.error || `HTTP ${response.status}`);
		}

		saveStatus.textContent = `Saved: Marker ${data.marker.id}, version v${data.marker.version}`;
		markerStringInput.value = '';
		await loadMarkerList();
	} catch (error) {
		saveStatus.textContent = `Save failed: ${error.message}`;
	}
});

function isAdmin() {
	return currentUserRole === 'admin';
}

function isMaintainer() {
	return currentUserRole === 'maintainer';
}

function showAdmin() {
	loginPanel.classList.add('hidden');
	adminPanel.classList.toggle('hidden', !isAdmin());
	adminPanelRaids.classList.remove('hidden');
	adminPanelMarkers.classList.remove('hidden');
	adminPanelMaintainers.classList.toggle('hidden', !isAdmin());
	logoutBtn?.classList.remove('hidden');
	if (adminRoleStatus) {
		adminRoleStatus.textContent = isAdmin()
			? 'Logged in as Admin'
			: isMaintainer()
				? 'Logged in as Maintainer'
				: '';
	}
}

function showLogin(message) {
	logoutBtn?.classList.add('hidden');
	if (adminRoleStatus) {
		adminRoleStatus.textContent = '';
	}
	localStorage.removeItem(TOKEN_KEY);
	currentUserRole = null;
	currentUsername = null;
	currentMaintainerGroupIds = [];
	maintainersCache = [];
	loginPanel.classList.remove('hidden');
	adminPanel.classList.add('hidden');
	adminPanelRaids.classList.add('hidden');
	adminPanelMarkers.classList.add('hidden');
	adminPanelMaintainers.classList.add('hidden');
	loginStatus.textContent = message || 'Please log in again.';
}

function getRequiredToken() {
	const token = localStorage.getItem(TOKEN_KEY);
	if (!token) {
		showLogin('Session expired. Please log in again.');
		throw new Error('Not logged in.');
	}
	return token;
}

function logout() {
	localStorage.removeItem(TOKEN_KEY);
	currentUserRole = null;
	currentUsername = null;
	currentMaintainerGroupIds = [];
	maintainersCache = [];
	if (adminRoleStatus) {
		adminRoleStatus.textContent = '';
	}
	logoutBtn?.classList.add('hidden');
	showLogin('Logged out.');
}

async function loadSelectionData() {
	try {
		const [groupsData, raidsData] = await Promise.all([
			apiGet('/api/groups'),
			apiGet('/api/raids'),
		]);
		const groups = groupsData.groups || [];
		const raids = raidsData.raids || [];
		groupsCache = groups;
		raidsCache = raids;

		if (isMaintainer()) {
			groupsCache = groups.filter((group) => currentMaintainerGroupIds.includes(group.id));
		}

		renderSelect(groupSelect, groupsCache, 'No groups available');
		renderSelect(raidSelect, raids, 'No raids available');
		renderEntityList(
			groupList,
			groups,
			'No groups available',
			isAdmin()
				? async (item) => {
						if (!confirm(`Really delete group?\n\n${item.name}`)) return;
						try {
							const activeToken = getRequiredToken();
							await apiDelete(`/api/groups/${encodeURIComponent(item.id)}`, activeToken);
							groupStatus.textContent = `Group deleted: ${item.name}`;
							await loadSelectionData();
						} catch (error) {
							groupStatus.textContent = `Delete failed: ${error.message}`;
						}
					}
				: null,
		);
		renderEntityList(
			raidList,
			raids,
			'No raids available',
			isAdmin()
				? async (item) => {
						if (!confirm(`Really delete raid?\n\n${item.name}`)) return;
						try {
							const activeToken = getRequiredToken();
							await apiDelete(`/api/raids/${encodeURIComponent(item.id)}`, activeToken);
							raidStatus.textContent = `Raid deleted: ${item.name}`;
							await loadSelectionData();
						} catch (error) {
							raidStatus.textContent = `Delete failed: ${error.message}`;
						}
					}
				: null,
		);
		await loadMarkerList();
		if (isAdmin()) {
			await loadMaintainerList();
		}
	} catch (error) {
		saveStatus.textContent = `Error loading lists: ${error.message}`;
	}
}

async function loadMarkerList() {
	const groupId = groupSelect.value;
	const raidId = raidSelect.value;
	const token = localStorage.getItem(TOKEN_KEY);

	try {
		const data = await apiGet('/api/markers', token);
		let markers = data.markers || [];

		if (isMaintainer()) {
			markers = markers.filter((marker) => currentMaintainerGroupIds.includes(marker.groupId));
		}

		if (groupId) {
			markers = markers.filter((marker) => marker.groupId === groupId);
		}
		if (raidId) {
			markers = markers.filter((marker) => marker.raidId === raidId);
		}

		markers = sortMarkers(markers);
		renderMarkerTable(markers, 'No markers available');
	} catch (error) {
		renderMarkerTable([], `Error loading: ${error.message}`);
	}
}

function renderMarkerTable(markers, emptyLabel) {
	const tbody = markerTable.querySelector('tbody');
	tbody.innerHTML = '';

	if (!markers.length) {
		const row = document.createElement('tr');
		const cell = document.createElement('td');
		cell.colSpan = 5;
		cell.textContent = emptyLabel;
		row.appendChild(cell);
		tbody.appendChild(row);
		return;
	}

	for (const marker of markers) {
		const tr = document.createElement('tr');
		const groupName = getEntityName(groupsCache, marker.groupId);
		const raidName = getEntityName(raidsCache, marker.raidId);
		const markerType = marker.type || 'Unknown';

		function createCell(content) {
			const td = document.createElement('td');
			td.appendChild(content);
			return td;
		}
		tr.appendChild(createCell(document.createTextNode(groupName)));
		tr.appendChild(createCell(document.createTextNode(raidName)));
		tr.appendChild(createCell(document.createTextNode(markerType)));
		tr.appendChild(createCell(document.createTextNode(`v${marker.version}`)));

		const actionsTd = document.createElement('td');
		const detailUrl = getMarkerDetailUrl(marker.id);

		const detailButton = document.createElement('button');
		detailButton.type = 'button';
		detailButton.classList.add('inline-button');
		detailButton.textContent = 'View details';
		detailButton.addEventListener('click', () => {
			window.open(detailUrl, '_blank', 'noopener,noreferrer');
		});

		const copyLinkButton = document.createElement('button');
		copyLinkButton.type = 'button';
		copyLinkButton.classList.add('inline-button');
		copyLinkButton.textContent = 'Copy link';
		copyLinkButton.addEventListener('click', async () => {
			const ok = await copyText(detailUrl);
			saveStatus.textContent = ok ? 'Link copied.' : 'Copy failed.';
		});

		actionsTd.appendChild(detailButton);
		actionsTd.appendChild(document.createTextNode(' '));
		actionsTd.appendChild(copyLinkButton);

		const canDeleteMarker = isAdmin();

		if (canDeleteMarker) {
			const deleteButton = document.createElement('button');
			deleteButton.type = 'button';
			deleteButton.innerHTML = DELETE_ICON_SVG;
			deleteButton.classList.add('icon-button');
			deleteButton.title = 'Delete';
			deleteButton.setAttribute('aria-label', 'Delete');
			deleteButton.addEventListener('click', async () => {
				if (!confirm(`Really delete marker?\n\nVersion v${marker.version}`)) return;
				try {
					const activeToken = getRequiredToken();
					await apiDelete(`/api/markers/${encodeURIComponent(marker.id)}`, activeToken);
					saveStatus.textContent = `Marker deleted: v${marker.version}`;
					await loadMarkerList();
				} catch (error) {
					saveStatus.textContent = `Delete failed: ${error.message}`;
				}
			});
			actionsTd.appendChild(document.createTextNode(' '));
			actionsTd.appendChild(deleteButton);
		}

		tr.appendChild(actionsTd);
		tbody.appendChild(tr);
	}
}

function getMarkerDetailUrl(markerId) {
	const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
	const markerPath = isLocalHost ? '../public/marker.html' : '../marker.html';
	const url = new URL(markerPath, window.location.href);
	url.searchParams.set('id', markerId);
	return url.toString();
}

async function copyText(text) {
	try {
		if (navigator.clipboard && navigator.clipboard.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {}

	const textarea = document.createElement('textarea');
	textarea.value = text;
	textarea.setAttribute('readonly', '');
	textarea.style.position = 'absolute';
	textarea.style.left = '-9999px';
	document.body.appendChild(textarea);
	textarea.select();
	textarea.setSelectionRange(0, textarea.value.length);

	try {
		return document.execCommand('copy');
	} catch {
		return false;
	} finally {
		document.body.removeChild(textarea);
	}
}

function getEntityName(items, id) {
	if (!id) return 'Unknown';
	const match = items.find((item) => item.id === id);
	return match ? match.name : id;
}

// sort markers by group → raid → type → version
function sortMarkers(markers) {
	return markers.sort((a, b) => {
		const ga = getEntityName(groupsCache, a.groupId);
		const gb = getEntityName(groupsCache, b.groupId);
		if (ga !== gb) return ga.localeCompare(gb);

		const ra = getEntityName(raidsCache, a.raidId);
		const rb = getEntityName(raidsCache, b.raidId);
		if (ra !== rb) return ra.localeCompare(rb);

		const ta = a.type || '';
		const tb = b.type || '';
		if (ta !== tb) return ta.localeCompare(tb);

		return (a.version || 0) - (b.version || 0);
	});
}

function renderEntityList(listElement, items, emptyLabel, onDelete) {
	listElement.innerHTML = '';

	if (!items.length) {
		const emptyItem = document.createElement('li');
		emptyItem.textContent = emptyLabel;
		listElement.appendChild(emptyItem);
		return;
	}

	for (const item of items) {
		const listItem = document.createElement('li');
		const text = document.createElement('span');
		text.textContent = item.name;

		const deleteButton = document.createElement('button');
		deleteButton.type = 'button';
		deleteButton.innerHTML = DELETE_ICON_SVG;
		deleteButton.classList.add('icon-button');
		deleteButton.title = 'Delete';
		deleteButton.setAttribute('aria-label', 'Delete');
		deleteButton.addEventListener('click', () => {
			onDelete(item);
		});

		listItem.appendChild(text);
		if (onDelete) {
			const deleteButton = document.createElement('button');
			deleteButton.type = 'button';
			deleteButton.innerHTML = DELETE_ICON_SVG;
			deleteButton.classList.add('icon-button');
			deleteButton.title = 'Delete';
			deleteButton.setAttribute('aria-label', 'Delete');
			deleteButton.addEventListener('click', () => {
				onDelete(item);
			});
			listItem.appendChild(document.createTextNode(' '));
			listItem.appendChild(deleteButton);
		}
		listElement.appendChild(listItem);
	}
}

async function loadMaintainerMe() {
	const activeToken = getRequiredToken();
	const data = await apiGet('/api/maintainers/me', activeToken);
	currentMaintainerGroupIds = data.groupIds || [];
}

async function loadMaintainerList() {
	if (!isAdmin()) return;
	const activeToken = getRequiredToken();
	const data = await apiGet('/api/maintainers', activeToken);
	const maintainers = data.maintainers || [];
	maintainersCache = maintainers;

	maintainerUsernameSelect.innerHTML = '';
	for (const maintainer of maintainers) {
		const option = document.createElement('option');
		option.value = maintainer.username;
		option.textContent = maintainer.username;
		maintainerUsernameSelect.appendChild(option);
	}

	updateMaintainerGroupSelection();
	renderMaintainerList(maintainers);
}

function updateMaintainerGroupSelection() {
	const username = maintainerUsernameSelect.value;
	const maintainer = maintainersCache.find((item) => item.username === username);
	const selectedGroupIds = maintainer?.groupIds || [];

	maintainerGroupSelect.innerHTML = '';
	for (const group of groupsCache) {
		const option = document.createElement('option');
		option.value = group.id;
		option.textContent = group.name;
		if (selectedGroupIds.includes(group.id)) {
			option.selected = true;
		}
		maintainerGroupSelect.appendChild(option);
	}
}

function renderMaintainerList(maintainers) {
	maintainerList.innerHTML = '';

	if (!maintainers.length) {
		const emptyItem = document.createElement('li');
		emptyItem.textContent = 'No maintainers created';
		maintainerList.appendChild(emptyItem);
		return;
	}

	for (const maintainer of maintainers) {
		const listItem = document.createElement('li');
		const text = document.createElement('span');
		text.textContent = `${maintainer.username} — ${maintainer.groupIds?.join(', ') || 'no groups'}`;

		const deleteButton = document.createElement('button');
		deleteButton.type = 'button';
		deleteButton.innerHTML = DELETE_ICON_SVG;
		deleteButton.classList.add('icon-button');
		deleteButton.title = 'Delete maintainer';
		deleteButton.setAttribute('aria-label', 'Delete maintainer');
		deleteButton.addEventListener('click', async () => {
			if (!confirm(`Really delete maintainer?\n\n${maintainer.username}`)) return;
			try {
				const activeToken = getRequiredToken();
				await apiDelete(`/api/maintainers/${encodeURIComponent(maintainer.username)}`, activeToken);
				await loadMaintainerList();
				maintainerStatus.textContent = `Maintainer deleted: ${maintainer.username}`;
			} catch (error) {
				maintainerStatus.textContent = `Error: ${error.message}`;
			}
		});

		listItem.appendChild(text);
		listItem.appendChild(document.createTextNode(' '));
		listItem.appendChild(deleteButton);
		maintainerList.appendChild(listItem);
	}
}

function renderSelect(selectElement, items, emptyLabel) {
	selectElement.innerHTML = '';

	const placeholderOption = document.createElement('option');
	placeholderOption.value = '';
	placeholderOption.textContent = 'Please select';
	placeholderOption.selected = true;
	selectElement.appendChild(placeholderOption);

	if (!items.length) {
		placeholderOption.textContent = emptyLabel;
		return;
	}

	for (const item of items) {
		const option = document.createElement('option');
		option.value = item.id;
		option.textContent = item.name;
		selectElement.appendChild(option);
	}
}

function parseJwtPayload(token) {
	if (!token || typeof token !== 'string') {
		return null;
	}

	const parts = token.split('.');
	if (parts.length !== 3) {
		return null;
	}

	try {
		const payload = parts[1];
		const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
		const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
		const decoded = atob(padded);
		return JSON.parse(decoded);
	} catch {
		return null;
	}
}

async function apiGet(path, token) {
	const headers = token
		? {
				authorization: `Bearer ${token}`,
			}
		: undefined;
	const response = await fetch(`${API_BASE}${path}`, {
		headers,
	});
	const data = await response.json();

	if (response.status === 401) {
		showLogin('Session expired. Please log in again.');
		throw new Error(data.error || 'Session expired.');
	}

	if (!response.ok) {
		throw new Error(data.error || `HTTP ${response.status}`);
	}

	return data;
}

async function apiDelete(path, token) {
	const response = await fetch(`${API_BASE}${path}`, {
		method: 'DELETE',
		headers: {
			authorization: `Bearer ${token}`,
		},
	});

	const data = await response.json();
	if (response.status === 401) {
		showLogin('Session expired. Please log in again.');
		throw new Error(data.error || 'Session expired.');
	}
	if (!response.ok) {
		throw new Error(data.error || `HTTP ${response.status}`);
	}

	return data;
}
