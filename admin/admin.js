const API_BASE = window.APP_CONFIG?.API_BASE || '';

if (!API_BASE) {
	throw new Error('API_BASE fehlt. Bitte config.js konfigurieren.');
}
const TOKEN_KEY = 'eso_admin_token';

const loginPanel = document.getElementById('loginPanel');
const adminPanel = document.getElementById('adminPanel');

const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginBtn = document.getElementById('loginBtn');
const loginStatus = document.getElementById('loginStatus');

const groupIdInput = document.getElementById('groupId');
const groupNameInput = document.getElementById('groupName');
const raidIdInput = document.getElementById('raidId');
const raidNameInput = document.getElementById('raidName');
const titleInput = document.getElementById('title');
const descriptionInput = document.getElementById('description');
const markerStringInput = document.getElementById('markerString');
const saveBtn = document.getElementById('saveBtn');
const saveStatus = document.getElementById('saveStatus');

const token = localStorage.getItem(TOKEN_KEY);
if (token) {
	showAdmin();
}

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
	} catch (error) {
		loginStatus.textContent = `Login fehlgeschlagen: ${error.message}`;
	}
});

saveBtn.addEventListener('click', async () => {
	const markerString = markerStringInput.value;
	if (markerString.length < 800 || markerString.length > 3000) {
		saveStatus.textContent = 'Marker-String muss 800 bis 3000 Zeichen lang sein.';
		return;
	}

	const payload = {
		groupId: groupIdInput.value.trim(),
		groupName: groupNameInput.value.trim(),
		raidId: raidIdInput.value.trim(),
		raidName: raidNameInput.value.trim(),
		title: titleInput.value.trim(),
		description: descriptionInput.value.trim(),
		markerString,
	};

	saveStatus.textContent = 'Speichern läuft...';

	try {
		const activeToken = localStorage.getItem(TOKEN_KEY);
		if (!activeToken) {
			throw new Error('Nicht eingeloggt.');
		}

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
	} catch (error) {
		saveStatus.textContent = `Speichern fehlgeschlagen: ${error.message}`;
	}
});

function showAdmin() {
	loginPanel.classList.add('hidden');
	adminPanel.classList.remove('hidden');
}
