const API_BASE = window.APP_CONFIG?.API_BASE || '';
const DELETE_ICON_SVG = '×';

if (!API_BASE) {
	throw new Error('API_BASE fehlt. Bitte config.js konfigurieren.');
}
const TOKEN_KEY = 'eso_admin_token';

const loginPanel = document.getElementById('loginPanel');
const adminPanel = document.getElementById('adminPanel');
const adminPanelRaids = document.getElementById('adminPanelRaids');
const adminPanelMarkers = document.getElementById('adminPanelMarkers');

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
const markerList = document.getElementById('markerList');

let groupsCache = [];
let raidsCache = [];

const token = localStorage.getItem(TOKEN_KEY);
if (token) {
	showAdmin();
	loadSelectionData();
}

groupSelect.addEventListener('change', () => {
	loadMarkerList();
});

raidSelect.addEventListener('change', () => {
	loadMarkerList();
});

loginBtn.addEventListener('click', async () => {
	loginStatus.textContent = 'Login läuft...';

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
		loginStatus.textContent = 'Login erfolgreich.';
		showAdmin();
		await loadSelectionData();
	} catch (error) {
		loginStatus.textContent = `Login fehlgeschlagen: ${error.message}`;
	}
});

createGroupBtn.addEventListener('click', async () => {
	groupStatus.textContent = 'Speichern läuft...';

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
		if (!response.ok) {
			throw new Error(data.error || `HTTP ${response.status}`);
		}

		groupStatus.textContent = data.created
			? `Raidgruppe erstellt: ${data.group.name}`
			: `Raidgruppe existiert bereits: ${data.group.name}`;
		newGroupNameInput.value = '';
		await loadSelectionData();
	} catch (error) {
		groupStatus.textContent = `Fehler: ${error.message}`;
	}
});

createRaidBtn.addEventListener('click', async () => {
	raidStatus.textContent = 'Speichern läuft...';

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
		if (!response.ok) {
			throw new Error(data.error || `HTTP ${response.status}`);
		}

		raidStatus.textContent = data.created
			? `Raid erstellt: ${data.raid.name}`
			: `Raid existiert bereits: ${data.raid.name}`;
		newRaidNameInput.value = '';
		await loadSelectionData();
	} catch (error) {
		raidStatus.textContent = `Fehler: ${error.message}`;
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
		saveStatus.textContent = 'Bitte zuerst eine Raidgruppe und einen Raid auswählen.';
		return;
	}

	if (!payload.markerString.trim()) {
		saveStatus.textContent = 'markerString ist erforderlich.';
		return;
	}

	if (!payload.type) {
		saveStatus.textContent = 'Typ ist erforderlich.';
		return;
	}

	saveStatus.textContent = 'Speichern läuft...';

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
		if (!response.ok) {
			throw new Error(data.error || `HTTP ${response.status}`);
		}

		saveStatus.textContent = `Gespeichert: Marker ${data.marker.id}, Version v${data.marker.version}`;
		markerStringInput.value = '';
		await loadMarkerList();
	} catch (error) {
		saveStatus.textContent = `Speichern fehlgeschlagen: ${error.message}`;
	}
});

function showAdmin() {
	loginPanel.classList.add('hidden');
	adminPanel.classList.remove('hidden');
	adminPanelRaids.classList.remove('hidden');
	adminPanelMarkers.classList.remove('hidden');
}

function getRequiredToken() {
	const token = localStorage.getItem(TOKEN_KEY);
	if (!token) {
		throw new Error('Nicht eingeloggt.');
	}
	return token;
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

		renderSelect(groupSelect, groups, 'Keine Raidgruppen vorhanden');
		renderSelect(raidSelect, raids, 'Keine Raids vorhanden');
		renderEntityList(groupList, groups, 'Keine Raidgruppen vorhanden', async (item) => {
			if (!confirm(`Raidgruppe wirklich löschen?\n\n${item.name}`)) return;
			try {
				const activeToken = getRequiredToken();
				await apiDelete(`/api/groups/${encodeURIComponent(item.id)}`, activeToken);
				groupStatus.textContent = `Raidgruppe gelöscht: ${item.name}`;
				await loadSelectionData();
			} catch (error) {
				groupStatus.textContent = `Löschen fehlgeschlagen: ${error.message}`;
			}
		});
		renderEntityList(raidList, raids, 'Keine Raids vorhanden', async (item) => {
			if (!confirm(`Raid wirklich löschen?\n\n${item.name}`)) return;
			try {
				const activeToken = getRequiredToken();
				await apiDelete(`/api/raids/${encodeURIComponent(item.id)}`, activeToken);
				raidStatus.textContent = `Raid gelöscht: ${item.name}`;
				await loadSelectionData();
			} catch (error) {
				raidStatus.textContent = `Löschen fehlgeschlagen: ${error.message}`;
			}
		});
		await loadMarkerList();
	} catch (error) {
		saveStatus.textContent = `Fehler beim Laden der Listen: ${error.message}`;
	}
}

async function loadMarkerList() {
	const groupId = groupSelect.value;
	const raidId = raidSelect.value;

	try {
		const data = await apiGet('/api/markers');
		let markers = data.markers || [];

		if (groupId) {
			markers = markers.filter((marker) => marker.groupId === groupId);
		}
		if (raidId) {
			markers = markers.filter((marker) => marker.raidId === raidId);
		}

		renderMarkerList(markers, 'Keine Marker vorhanden');
	} catch (error) {
		renderMarkerList([], `Fehler beim Laden: ${error.message}`);
	}
}

function renderMarkerList(markers, emptyLabel) {
	markerList.innerHTML = '';

	if (!markers.length) {
		const emptyItem = document.createElement('li');
		emptyItem.textContent = emptyLabel;
		markerList.appendChild(emptyItem);
		return;
	}

	for (const marker of markers) {
		const listItem = document.createElement('li');
		const groupName = getEntityName(groupsCache, marker.groupId);
		const raidName = getEntityName(raidsCache, marker.raidId);
		const markerType = marker.type || 'Unbekannt';
		const text = document.createElement('span');
		text.textContent = `v${marker.version} (Typ: ${markerType}, Raidgruppe: ${groupName}, Raid: ${raidName})`;

		const detailLink = document.createElement('a');
		detailLink.href = getMarkerDetailUrl(marker.id);
		detailLink.textContent = 'Zur Detailseite';
		detailLink.classList.add('detail-link');
		detailLink.target = '_blank';
		detailLink.rel = 'noopener noreferrer';

		const deleteButton = document.createElement('button');
		deleteButton.type = 'button';
		deleteButton.innerHTML = DELETE_ICON_SVG;
		deleteButton.classList.add('icon-button');
		deleteButton.title = 'Löschen';
		deleteButton.setAttribute('aria-label', 'Löschen');
		deleteButton.addEventListener('click', async () => {
			if (!confirm(`Marker wirklich löschen?\n\nVersion v${marker.version}`)) return;
			try {
				const activeToken = getRequiredToken();
				await apiDelete(`/api/markers/${encodeURIComponent(marker.id)}`, activeToken);
				saveStatus.textContent = `Marker gelöscht: v${marker.version}`;
				await loadMarkerList();
			} catch (error) {
				saveStatus.textContent = `Löschen fehlgeschlagen: ${error.message}`;
			}
		});

		listItem.appendChild(text);
		listItem.appendChild(document.createTextNode(' '));
		listItem.appendChild(deleteButton);
		listItem.appendChild(document.createElement('br'));
		listItem.appendChild(detailLink);
		markerList.appendChild(listItem);
	}
}

function getMarkerDetailUrl(markerId) {
	const isLocalHost = ['localhost', '127.0.0.1'].includes(window.location.hostname);
	const markerPath = isLocalHost ? '/public/marker.html' : '/marker.html';
	const url = new URL(markerPath, window.location.origin);
	url.searchParams.set('id', markerId);
	return url.toString();
}

function getEntityName(items, id) {
	if (!id) return 'Unbekannt';
	const match = items.find((item) => item.id === id);
	return match ? match.name : id;
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
		deleteButton.title = 'Löschen';
		deleteButton.setAttribute('aria-label', 'Löschen');
		deleteButton.addEventListener('click', () => {
			onDelete(item);
		});

		listItem.appendChild(text);
		listItem.appendChild(document.createTextNode(' '));
		listItem.appendChild(deleteButton);
		listElement.appendChild(listItem);
	}
}

function renderSelect(selectElement, items, emptyLabel) {
	selectElement.innerHTML = '';

	const placeholderOption = document.createElement('option');
	placeholderOption.value = '';
	placeholderOption.textContent = 'Bitte auswählen';
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

async function apiGet(path) {
	const response = await fetch(`${API_BASE}${path}`);
	const data = await response.json();

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
	if (!response.ok) {
		throw new Error(data.error || `HTTP ${response.status}`);
	}

	return data;
}
