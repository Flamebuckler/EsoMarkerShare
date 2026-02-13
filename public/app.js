const API_BASE = window.APP_CONFIG?.API_BASE || '';

if (!API_BASE) {
	throw new Error('API_BASE fehlt. Bitte config.js konfigurieren.');
}

const groupsContainer = document.getElementById('groups');
const raidsContainer = document.getElementById('raids');
const markersContainer = document.getElementById('markers');

const markerDetails = document.getElementById('markerDetails');
const markerGroupName = document.getElementById('markerGroupName');
const markerRaidName = document.getElementById('markerRaidName');
const markerType = document.getElementById('markerType');
const markerVersion = document.getElementById('markerVersion');
const markerString = document.getElementById('markerString');
const copyBtn = document.getElementById('copyBtn');
const copyStatus = document.getElementById('copyStatus');
const directLink = document.getElementById('directLink');

let selectedGroupId = '';
let selectedRaidId = '';
const MARKER_TYPE_ROWS = ['Akamatsu', 'Breadcrumbs', 'Elms'];

init();

async function init() {
	try {
		const groupsResponse = await apiGet('/api/groups');
		renderGroups(groupsResponse.groups || []);
	} catch (error) {
		groupsContainer.textContent = `Fehler: ${error.message}`;
	}
}

function renderGroups(groups) {
	groupsContainer.innerHTML = '';

	if (!groups.length) {
		groupsContainer.textContent = 'Keine Gruppen gefunden.';
		return;
	}

	for (const group of groups) {
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = group.name;
		button.addEventListener('click', async () => {
			selectedGroupId = group.id;
			selectedRaidId = '';
			activateButton(groupsContainer, button);
			markersContainer.innerHTML = '';
			hideMarkerDetails();
			await loadRaids(group.id);
		});
		groupsContainer.appendChild(button);
	}
}

async function loadRaids(groupId) {
	raidsContainer.innerHTML = 'Lädt...';
	markersContainer.innerHTML = '';

	try {
		const response = await apiGet(`/api/groups/${encodeURIComponent(groupId)}/raids`);
		renderRaids(response.raids || []);
	} catch (error) {
		raidsContainer.textContent = `Fehler: ${error.message}`;
	}
}

function renderRaids(raids) {
	raidsContainer.innerHTML = '';

	if (!raids.length) {
		raidsContainer.textContent = 'Keine Raids für diese Gruppe gefunden.';
		return;
	}

	for (const raid of raids) {
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = raid.name;
		button.addEventListener('click', async () => {
			selectedRaidId = raid.id;
			activateButton(raidsContainer, button);
			hideMarkerDetails();
			await loadMarkers(selectedGroupId, raid.id);
		});
		raidsContainer.appendChild(button);
	}
}

async function loadMarkers(groupId, raidId) {
	markersContainer.innerHTML = 'Lädt...';

	try {
		const response = await apiGet(
			`/api/groups/${encodeURIComponent(groupId)}/raids/${encodeURIComponent(raidId)}/markers`,
		);
		renderMarkers(response.markers || []);
	} catch (error) {
		markersContainer.textContent = `Fehler: ${error.message}`;
	}
}

function renderMarkers(markers) {
	markersContainer.innerHTML = '';

	if (!markers.length) {
		markersContainer.textContent = 'Keine Marker-Versionen gefunden.';
		return;
	}

	const grouped = new Map(MARKER_TYPE_ROWS.map((type) => [type, []]));

	for (const marker of markers) {
		const normalized = normalizeTypeForRow(marker.type);
		if (!grouped.has(normalized)) {
			continue;
		}
		grouped.get(normalized).push(marker);
	}

	for (const rowType of MARKER_TYPE_ROWS) {
		const row = document.createElement('div');
		row.classList.add('marker-row');

		const label = document.createElement('div');
		label.classList.add('marker-row-label');
		label.textContent = rowType;
		row.appendChild(label);

		const versions = document.createElement('div');
		versions.classList.add('marker-row-versions');
		const rowMarkers = grouped.get(rowType) || [];

		if (!rowMarkers.length) {
			const empty = document.createElement('span');
			empty.classList.add('muted');
			empty.textContent = '—';
			versions.appendChild(empty);
		} else {
			for (const marker of rowMarkers) {
				const button = document.createElement('button');
				button.type = 'button';
				button.textContent = `v${marker.version}`;
				button.addEventListener('click', async () => {
					activateButton(markersContainer, button);
					await loadMarker(marker.id);
				});
				versions.appendChild(button);
			}
		}

		row.appendChild(versions);
		markersContainer.appendChild(row);
	}
}

function normalizeTypeForRow(type) {
	const value = String(type || '')
		.trim()
		.toLowerCase();
	if (value === 'akamatsu') return 'Akamatsu';
	if (value === 'breadcrumbs') return 'Breadcrumbs';
	if (value === 'elms') return 'Elms';
	return '';
}

async function loadMarker(markerId) {
	try {
		const [markerResponse, groupsResponse, raidsResponse] = await Promise.all([
			apiGet(`/api/markers/${encodeURIComponent(markerId)}`),
			apiGet('/api/groups'),
			apiGet('/api/raids'),
		]);

		showMarkerDetails(
			markerResponse.marker,
			groupsResponse.groups || [],
			raidsResponse.raids || [],
		);
	} catch (error) {
		hideMarkerDetails();
		copyStatus.textContent = `Fehler: ${error.message}`;
	}
}

function showMarkerDetails(marker, groups, raids) {
	markerDetails.classList.remove('hidden');
	const group = groups.find((item) => item.id === marker.groupId);
	const raid = raids.find((item) => item.id === marker.raidId);

	markerGroupName.textContent = group ? group.name : marker.groupId || 'Unbekannt';
	markerRaidName.textContent = raid ? raid.name : marker.raidId || 'Unbekannt';
	markerType.textContent = marker.type || 'Unbekannt';
	markerVersion.textContent = String(marker.version);
	markerString.value = marker.markerString;
	copyStatus.textContent = '';

	const markerUrl = `${window.location.origin}${window.location.pathname.replace(/index\.html$/, '')}marker.html?id=${encodeURIComponent(marker.id)}`;
	directLink.href = markerUrl;
	directLink.textContent = markerUrl;

	copyBtn.onclick = async () => {
		const ok = await copyText(marker.markerString);
		copyStatus.textContent = ok ? 'Kopiert.' : 'Kopieren fehlgeschlagen.';
	};
}

function hideMarkerDetails() {
	markerDetails.classList.add('hidden');
}

function activateButton(container, activeButton) {
	for (const child of container.querySelectorAll('button')) {
		child.classList.remove('active');
	}
	activeButton.classList.add('active');
}

async function copyText(text) {
	try {
		if (navigator.clipboard && navigator.clipboard.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {}

	markerString.focus();
	markerString.select();
	markerString.setSelectionRange(0, markerString.value.length);

	try {
		return document.execCommand('copy');
	} catch {
		return false;
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
