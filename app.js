// ============================================================
// DATABASE (IndexedDB)
// ============================================================

const DB_NAME = 'lernkarten';
const DB_VER  = 2;
let db;

function dbInit() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onerror = () => rej(req.error);
    req.onsuccess = () => { db = req.result; res(); };
    req.onupgradeneeded = e => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('gruppen'))
        d.createObjectStore('gruppen', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('studenten')) {
        const s = d.createObjectStore('studenten', { keyPath: 'id' });
        s.createIndex('gruppeId', 'gruppeId');
      }
      if (!d.objectStoreNames.contains('sitzungen'))
        d.createObjectStore('sitzungen', { keyPath: 'id' });
    };
  });
}

function dbGetAll(store) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror  = () => rej(req.error);
  });
}

function dbPut(store, item) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).put(item);
    req.onsuccess = () => res();
    req.onerror  = () => rej(req.error);
  });
}

function dbDelete(store, id) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).delete(id);
    req.onsuccess = () => res();
    req.onerror  = () => rej(req.error);
  });
}

function dbClear(store) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).clear();
    req.onsuccess = () => res();
    req.onerror  = () => rej(req.error);
  });
}

// ============================================================
// STATE
// ============================================================

let gruppen   = [];
let studenten = [];

const urlCache = new Map();
function getFotoUrl(s) {
  if (!urlCache.has(s.id)) urlCache.set(s.id, URL.createObjectURL(s.foto));
  return urlCache.get(s.id);
}
function revokeUrl(id) {
  if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
}

// learning
let lernKarten    = [];
let lernIndex     = 0;
let nameVisible   = false;
let gewusst       = 0;
let nichtGewusst  = 0;
let lernModus     = 'foto'; // 'foto' = Foto→Name, 'name' = Name→Foto
const answeredIds     = new Set();
const gewusstIds      = new Set();
const nichtGewusstIds = new Set();

// ============================================================
// PHOTO COMPRESSION
// ============================================================

function compressPhoto(file) {
  return new Promise(resolve => {
    const img = new Image();
    const tmp = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 900;
      let w = img.naturalWidth, h = img.naturalHeight;
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX; }
        else       { w = Math.round(w * MAX / h); h = MAX; }
      }
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(tmp);
      c.toBlob(blob => resolve(blob), 'image/jpeg', 0.85);
    };
    img.src = tmp;
  });
}

// ============================================================
// DATA HELPERS
// ============================================================

async function ladeAlles() {
  [gruppen, studenten] = await Promise.all([dbGetAll('gruppen'), dbGetAll('studenten')]);
}

function gruppeKartenAnzahl(gid) {
  return studenten.filter(s => s.gruppeId === gid).length;
}

// ============================================================
// RENDER – VERWALTUNG
// ============================================================

function renderVerwaltung() {
  // Gruppen-Liste
  const gList = document.getElementById('gruppen-liste');
  gList.innerHTML = gruppen.length === 0
    ? '<p class="hinweis" style="padding:0.5rem 0">Noch keine Gruppen.</p>'
    : gruppen.map(g => `
      <div class="gruppe-item">
        <span class="gruppe-dot"></span>
        <span class="gruppe-name">${esc(g.name)}</span>
        <span class="gruppe-count">${gruppeKartenAnzahl(g.id)} Karte(n)</span>
        <button class="btn-gruppe-ren" data-id="${g.id}" title="Umbenennen">✏️</button>
        <button class="btn-gruppe-del" data-id="${g.id}" title="Löschen">✕</button>
      </div>`).join('');

  // Select mit gespeicherter letzter Gruppe
  const sel     = document.getElementById('select-gruppe');
  const savedId = localStorage.getItem('lastGruppeId') || sel.value;
  sel.innerHTML = '<option value="">Gruppe wählen…</option>' +
    gruppen.map(g => `<option value="${g.id}"${g.id === savedId ? ' selected' : ''}>${esc(g.name)}</option>`).join('');

  // Karten nach Gruppen
  const container = document.getElementById('karten-nach-gruppen');
  const hinweis   = document.getElementById('keine-karten-hinweis');
  document.getElementById('karten-gesamt').textContent = studenten.length;

  if (studenten.length === 0) {
    container.innerHTML = '';
    hinweis.classList.remove('hidden');
    return;
  }
  hinweis.classList.add('hidden');

  const byGruppe = new Map();
  gruppen.forEach(g => byGruppe.set(g.id, []));
  const ohneGruppe = [];
  studenten.forEach(s => {
    if (byGruppe.has(s.gruppeId)) byGruppe.get(s.gruppeId).push(s);
    else ohneGruppe.push(s);
  });

  let html = '';
  gruppen.forEach(g => {
    const arr = byGruppe.get(g.id);
    if (!arr.length) return;
    html += `<div class="gruppe-karten-section">
      <div class="gruppe-karten-title">${esc(g.name)}</div>
      ${arr.map(s => `
        <div class="karte-item">
          <img src="${getFotoUrl(s)}" alt="${esc(s.name)}" loading="lazy">
          <span class="karte-name">${esc(s.name)}</span>
          <button class="btn-karte-ren" data-id="${s.id}" title="Umbenennen">✏️</button>
          <button class="btn-karte-del" data-id="${s.id}" title="Löschen">✕</button>
        </div>`).join('')}
    </div>`;
  });
  if (ohneGruppe.length) {
    html += `<div class="gruppe-karten-section">
      <div class="gruppe-karten-title">Ohne Gruppe</div>
      ${ohneGruppe.map(s => `
        <div class="karte-item">
          <img src="${getFotoUrl(s)}" alt="${esc(s.name)}" loading="lazy">
          <span class="karte-name">${esc(s.name)}</span>
          <button class="btn-karte-ren" data-id="${s.id}" title="Umbenennen">✏️</button>
          <button class="btn-karte-del" data-id="${s.id}" title="Löschen">✕</button>
        </div>`).join('')}
    </div>`;
  }
  container.innerHTML = html;
}

// ============================================================
// RENDER – LERNEN (Gruppenauswahl)
// ============================================================

function renderLernAuswahl() {
  const container = document.getElementById('gruppen-checkboxen');
  if (gruppen.length === 0) {
    container.innerHTML = '<p class="hinweis">Bitte zuerst Gruppen und Karten anlegen.</p>';
    document.getElementById('btn-lernen-start').disabled = true;
    return;
  }
  container.innerHTML = gruppen.map(g => {
    const n = gruppeKartenAnzahl(g.id);
    return `
      <div class="gruppe-check-item" data-gid="${g.id}">
        <div class="check-box">✓</div>
        <div class="check-label">
          <strong>${esc(g.name)}</strong>
          <span>${n} Karte${n !== 1 ? 'n' : ''}</span>
        </div>
      </div>`;
  }).join('');
  updateLernStartBtn();
}

function getSelectedGids() {
  return [...document.querySelectorAll('.gruppe-check-item.selected')].map(el => el.dataset.gid);
}

function updateLernStartBtn() {
  const total = getSelectedGids().reduce((s, gid) => s + gruppeKartenAnzahl(gid), 0);
  const btn = document.getElementById('btn-lernen-start');
  btn.disabled = total === 0;
  btn.textContent = total > 0 ? `Lernen starten (${total} Karte${total !== 1 ? 'n' : ''})` : 'Lernen starten';
}

// ============================================================
// RENDER – STATISTIK
// ============================================================

async function renderStatistik() {
  const sitzungen = await dbGetAll('sitzungen');
  sitzungen.sort((a, b) => new Date(b.datum) - new Date(a.datum));

  // Übersicht
  document.getElementById('stat-total-sitzungen').textContent = sitzungen.length;
  if (sitzungen.length === 0) {
    document.getElementById('stat-avg-score').textContent = '—';
    document.getElementById('stat-total-abgefragt').textContent = '0';
  } else {
    const totalAbgefragt = sitzungen.reduce((s, x) => s + x.total, 0);
    const avgScore = sitzungen.reduce((s, x) => s + x.score, 0) / sitzungen.length;
    document.getElementById('stat-avg-score').textContent = Math.round(avgScore) + '%';
    document.getElementById('stat-total-abgefragt').textContent = totalAbgefragt;
  }

  // Schwierigste Namen
  const nameStats = new Map(); // name → { gewusst, nachgeschaut }
  for (const sitz of sitzungen) {
    for (const detail of (sitz.details || [])) {
      if (!nameStats.has(detail.name)) nameStats.set(detail.name, { gewusst: 0, nachgeschaut: 0 });
      const stat = nameStats.get(detail.name);
      if (detail.status === 'gewusst') stat.gewusst++;
      else if (detail.status === 'nachgeschaut') stat.nachgeschaut++;
    }
  }

  const schwierigEl = document.getElementById('schwierigste-namen');
  const keineSchEl  = document.getElementById('keine-schwierig-hinweis');

  const nameArr = [...nameStats.entries()]
    .filter(([, s]) => s.nachgeschaut > 0)
    .map(([name, s]) => {
      const total = s.gewusst + s.nachgeschaut;
      const rate  = Math.round((s.nachgeschaut / total) * 100);
      return { name, rate, total };
    })
    .sort((a, b) => b.rate - a.rate || b.total - a.total)
    .slice(0, 8);

  const schwaeBtn = document.getElementById('btn-schwaeche-ueben');
  if (nameArr.length === 0) {
    schwierigEl.innerHTML = '';
    keineSchEl.classList.remove('hidden');
    schwaeBtn.classList.add('hidden');
  } else {
    keineSchEl.classList.add('hidden');
    schwierigEl.innerHTML = nameArr.map((item, i) => `
      <div class="schwierig-item">
        <span class="schwierig-rank">${i + 1}</span>
        <span class="schwierig-name">${esc(item.name)}</span>
        <span class="schwierig-rate">${item.rate}% ✗</span>
      </div>`).join('');

    // Schwächste 20% (min. 5) berechnen
    const allNamen = [...nameStats.entries()]
      .filter(([, s]) => s.gewusst + s.nachgeschaut > 0)
      .map(([name, s]) => {
        const t = s.gewusst + s.nachgeschaut;
        return { name, fehlerRate: s.nachgeschaut / t };
      })
      .sort((a, b) => b.fehlerRate - a.fehlerRate);
    const anzahl = Math.max(5, Math.ceil(allNamen.length * 0.2));
    const schwacheNamen = new Set(allNamen.slice(0, anzahl).map(x => x.name));
    const schwacheKarten = studenten.filter(s => schwacheNamen.has(s.name));
    if (schwacheKarten.length > 0) {
      schwaeBtn.textContent = `⟳ Schwächste ${schwacheKarten.length} Karte${schwacheKarten.length !== 1 ? 'n' : ''} jetzt üben`;
      schwaeBtn.classList.remove('hidden');
      schwaeBtn.onclick = () => {
        showView('lernen');
        document.getElementById('lernen-auswahl').classList.add('hidden');
        starteSession(schwacheKarten);
        toast(`${schwacheKarten.length} schwächste Karte${schwacheKarten.length !== 1 ? 'n' : ''} ausgewählt`);
      };
    } else {
      schwaeBtn.classList.add('hidden');
    }
  }

  // Letzte Sitzungen
  const verlaufEl  = document.getElementById('sitzungen-verlauf');
  const keineVerlEl = document.getElementById('keine-verlauf-hinweis');

  if (sitzungen.length === 0) {
    verlaufEl.innerHTML = '';
    keineVerlEl.classList.remove('hidden');
  } else {
    keineVerlEl.classList.add('hidden');
    verlaufEl.innerHTML = sitzungen.slice(0, 10).map(sitz => {
      const d = new Date(sitz.datum);
      const datum = d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
      const uhrzeit = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      const scoreClass = sitz.score >= 75 ? 'gut' : sitz.score >= 50 ? 'mitte' : 'schlecht';
      return `
        <div class="sitzung-item">
          <span class="sitzung-datum">${datum} ${uhrzeit}</span>
          <span class="sitzung-info">${sitz.total} Karte${sitz.total !== 1 ? 'n' : ''}</span>
          <span class="sitzung-score ${scoreClass}">${sitz.score}%</span>
        </div>`;
    }).join('');
  }
}

// ============================================================
// STATISTICS – SESSION SAVING
// ============================================================

async function speichereSitzung() {
  const total = lernKarten.length;
  if (total === 0) return;

  const details = lernKarten.map(s => {
    let status = 'übersprungen';
    if (gewusstIds.has(s.id))      status = 'gewusst';
    else if (nichtGewusstIds.has(s.id)) status = 'nachgeschaut';
    return { name: s.name, status };
  });

  const answeredCount = gewusst + nichtGewusst;
  const score = answeredCount > 0 ? Math.round((gewusst / answeredCount) * 100) : 0;

  const sitzung = {
    id:      Date.now().toString(),
    datum:   new Date().toISOString(),
    total,
    gewusst,
    nichtGewusst,
    score,
    details
  };
  await dbPut('sitzungen', sitzung);
}

// ============================================================
// FLASHCARD LOGIC
// ============================================================

function zeigeKarte() {
  nameVisible = false;
  document.getElementById('lern-name-overlay').classList.add('hidden');

  const s = lernKarten[lernIndex];
  document.getElementById('lern-name-text').textContent = s.name;
  document.getElementById('lern-position').textContent  = `${lernIndex + 1} / ${lernKarten.length}`;
  document.getElementById('btn-zurueck').classList.toggle('invisible', lernIndex === 0);
  document.getElementById('btn-weiter').classList.toggle('invisible', lernIndex === lernKarten.length - 1);

  if (lernModus === 'name') {
    // Name→Foto: Namenanzeige, Foto versteckt
    document.getElementById('lernkarte-foto-wrapper').classList.add('hidden');
    document.getElementById('lern-name-karte').classList.remove('hidden');
    document.getElementById('lern-name-karte-text').textContent = s.name;
    document.getElementById('btn-aufdecken').textContent = 'Gesicht zeigen';
  } else {
    // Foto→Name: Foto zeigen, Namenskarte versteckt
    document.getElementById('lern-foto').src = getFotoUrl(s);
    document.getElementById('lernkarte-foto-wrapper').classList.remove('hidden');
    document.getElementById('lern-name-karte').classList.add('hidden');
    document.getElementById('btn-aufdecken').textContent = 'Name zeigen';
  }
}

function zeigeName() {
  const s = lernKarten[lernIndex];
  if (!answeredIds.has(s.id)) {
    nichtGewusst++;
    nichtGewusstIds.add(s.id);
    answeredIds.add(s.id);
  }
  nameVisible = true;
  const istLetzte = lernIndex === lernKarten.length - 1;

  if (lernModus === 'name') {
    // Foto aufdecken: Namenskarte verstecken, Foto zeigen
    document.getElementById('lern-foto').src = getFotoUrl(s);
    document.getElementById('lernkarte-foto-wrapper').classList.remove('hidden');
    document.getElementById('lern-name-karte').classList.add('hidden');
  } else {
    // Name-Overlay über Foto einblenden
    document.getElementById('lern-name-overlay').classList.remove('hidden');
  }
  document.getElementById('btn-aufdecken').textContent = istLetzte ? 'Fertig ✓' : 'Weiter →';
}

function naechsteKarteOderEnde() {
  if (lernIndex < lernKarten.length - 1) {
    lernIndex++;
    zeigeKarte();
  } else {
    zeigeEnde();
  }
}

async function zeigeEnde() {
  await speichereSitzung();
  document.getElementById('lernen-flashcard').classList.add('hidden');
  document.getElementById('lernen-ende').classList.remove('hidden');
  const total = lernKarten.length;
  document.getElementById('stat-gewusst').textContent = gewusst;
  document.getElementById('stat-nicht').textContent   = nichtGewusst;
  document.getElementById('ende-subtitle').textContent = `${total} Karte${total !== 1 ? 'n' : ''} abgefragt`;
}

function starteSession(karten) {
  lernKarten   = mischen([...karten]);
  lernIndex    = 0;
  gewusst      = 0;
  nichtGewusst = 0;
  answeredIds.clear();
  gewusstIds.clear();
  nichtGewusstIds.clear();
  document.getElementById('lernen-ende').classList.add('hidden');
  document.getElementById('lernen-flashcard').classList.remove('hidden');
  zeigeKarte();
}

// ============================================================
// VIEW NAVIGATION
// ============================================================

function showView(name) {
  ['verwaltung', 'lernen', 'statistik', 'sicherung'].forEach(v =>
    document.getElementById(`view-${v}`).classList.toggle('hidden', v !== name));
  document.querySelectorAll('.nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.view === name));
  if (name === 'lernen') {
    document.getElementById('lernen-auswahl').classList.remove('hidden');
    document.getElementById('lernen-flashcard').classList.add('hidden');
    document.getElementById('lernen-ende').classList.add('hidden');
    renderLernAuswahl();
  }
  if (name === 'statistik') {
    renderStatistik();
  }
}

// ============================================================
// EXPORT / IMPORT
// ============================================================

function blobToDataUrl(blob) {
  return new Promise(res => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl) {
  const [header, b64] = dataUrl.split(',');
  const mime  = header.match(/:(.*?);/)[1];
  const bytes = atob(b64);
  const arr   = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

async function exportDaten() {
  const studExport = await Promise.all(studenten.map(async s => ({
    ...s, foto: await blobToDataUrl(s.foto)
  })));
  const payload = { version: 1, exportiert: new Date().toISOString(), gruppen, studenten: studExport };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = Object.assign(document.createElement('a'), {
    href: url,
    download: `lernkarten-${new Date().toISOString().slice(0,10)}.json`
  });
  a.click();
  URL.revokeObjectURL(url);
  toast('Backup erfolgreich exportiert');
}

async function importDaten(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!data.gruppen || !data.studenten) throw new Error('Ungültiges Format');
    studenten.forEach(s => revokeUrl(s.id));
    await dbClear('gruppen');
    await dbClear('studenten');
    for (const g of data.gruppen) await dbPut('gruppen', g);
    for (const s of data.studenten) {
      await dbPut('studenten', { ...s, foto: dataUrlToBlob(s.foto) });
    }
    await ladeAlles();
    renderVerwaltung();
    toast(`Import erfolgreich – ${studenten.length} Karten geladen`);
  } catch (e) {
    toast('Fehler beim Import: ' + e.message);
  }
}

// ============================================================
// UTILITY
// ============================================================

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2500);
}

function mischen(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ============================================================
// EVENTS – VERWALTUNG
// ============================================================

document.querySelectorAll('.nav-item').forEach(btn =>
  btn.addEventListener('click', () => showView(btn.dataset.view)));

// Info-Modal
document.getElementById('btn-info').addEventListener('click', () =>
  document.getElementById('info-modal').classList.remove('hidden'));
document.getElementById('btn-info-close').addEventListener('click', () =>
  document.getElementById('info-modal').classList.add('hidden'));
document.getElementById('info-modal').addEventListener('click', e => {
  if (e.target === e.currentTarget) e.currentTarget.classList.add('hidden');
});

document.getElementById('btn-gruppe-add').addEventListener('click', async () => {
  const input = document.getElementById('input-neue-gruppe');
  const name  = input.value.trim();
  if (!name) return;
  const g = { id: Date.now().toString(), name, erstellt: new Date().toISOString() };
  await dbPut('gruppen', g);
  gruppen.push(g);
  input.value = '';
  renderVerwaltung();
  toast(`Gruppe „${name}" erstellt`);
});

document.getElementById('input-neue-gruppe').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('btn-gruppe-add').click();
});

// Gruppe umbenennen / löschen
document.getElementById('gruppen-liste').addEventListener('click', async e => {
  const renBtn = e.target.closest('.btn-gruppe-ren');
  if (renBtn) {
    const g = gruppen.find(x => x.id === renBtn.dataset.id);
    const newName = prompt('Neuer Gruppenname:', g.name);
    if (newName && newName.trim() && newName.trim() !== g.name) {
      g.name = newName.trim();
      await dbPut('gruppen', g);
      renderVerwaltung();
      toast(`Gruppe umbenannt in „${g.name}"`);
    }
    return;
  }
  const delBtn = e.target.closest('.btn-gruppe-del');
  if (!delBtn) return;
  const id = delBtn.dataset.id;
  const g  = gruppen.find(x => x.id === id);
  const n  = gruppeKartenAnzahl(id);
  if (!confirm(n > 0 ? `Gruppe „${g.name}" und ${n} Karte(n) löschen?` : `Gruppe „${g.name}" löschen?`)) return;
  const zuLoeschen = studenten.filter(s => s.gruppeId === id);
  for (const s of zuLoeschen) { await dbDelete('studenten', s.id); revokeUrl(s.id); }
  await dbDelete('gruppen', id);
  gruppen   = gruppen.filter(x => x.id !== id);
  studenten = studenten.filter(s => s.gruppeId !== id);
  renderVerwaltung();
  toast('Gruppe gelöscht');
});

// Letzte Gruppe merken
document.getElementById('select-gruppe').addEventListener('change', e => {
  if (e.target.value) localStorage.setItem('lastGruppeId', e.target.value);
});

// Foto Vorschau
document.getElementById('input-foto').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    document.getElementById('foto-vorschau').src = ev.target.result;
    document.getElementById('foto-vorschau').classList.remove('hidden');
    document.getElementById('upload-placeholder').classList.add('hidden');
  };
  reader.readAsDataURL(file);
});

// Karte speichern
document.getElementById('form-karte').addEventListener('submit', async e => {
  e.preventDefault();
  const name     = document.getElementById('input-name').value.trim();
  const gruppeId = document.getElementById('select-gruppe').value;
  const file     = document.getElementById('input-foto').files[0];
  if (!name || !gruppeId || !file) return;

  const btn = document.getElementById('btn-karte-speichern');
  btn.disabled = true; btn.textContent = 'Wird gespeichert…';
  try {
    const blob = await compressPhoto(file);
    const s = { id: Date.now().toString(), name, gruppeId, foto: blob, erstellt: new Date().toISOString() };
    await dbPut('studenten', s);
    studenten.push(s);
    document.getElementById('input-name').value = '';
    document.getElementById('input-foto').value = '';
    document.getElementById('foto-vorschau').classList.add('hidden');
    document.getElementById('upload-placeholder').classList.remove('hidden');
    renderVerwaltung();
    toast(`Karte für „${name}" gespeichert`);
  } catch (err) {
    toast('Fehler: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Karte speichern';
  }
});

// Karte umbenennen / löschen
document.getElementById('karten-nach-gruppen').addEventListener('click', async e => {
  const renBtn = e.target.closest('.btn-karte-ren');
  if (renBtn) {
    const s = studenten.find(x => x.id === renBtn.dataset.id);
    const newName = prompt('Neuer Name:', s.name);
    if (newName && newName.trim() && newName.trim() !== s.name) {
      s.name = newName.trim();
      await dbPut('studenten', s);
      renderVerwaltung();
      toast(`Karte umbenannt in „${s.name}"`);
    }
    return;
  }
  const delBtn = e.target.closest('.btn-karte-del');
  if (!delBtn) return;
  const id = delBtn.dataset.id;
  const s  = studenten.find(x => x.id === id);
  if (!confirm(`Karte „${s.name}" löschen?`)) return;
  await dbDelete('studenten', id);
  revokeUrl(id);
  studenten = studenten.filter(x => x.id !== id);
  renderVerwaltung();
  toast('Karte gelöscht');
});

// ============================================================
// EVENTS – LERNEN
// ============================================================

// Lernmodus-Toggle
document.querySelectorAll('.lernmodus-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    lernModus = btn.dataset.modus;
    document.querySelectorAll('.lernmodus-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

document.getElementById('gruppen-checkboxen').addEventListener('click', e => {
  const item = e.target.closest('.gruppe-check-item');
  if (!item) return;
  item.classList.toggle('selected');
  updateLernStartBtn();
});

document.getElementById('btn-alle-waehlen').addEventListener('click', () => {
  document.querySelectorAll('.gruppe-check-item').forEach(el => el.classList.add('selected'));
  updateLernStartBtn();
});
document.getElementById('btn-keine-waehlen').addEventListener('click', () => {
  document.querySelectorAll('.gruppe-check-item').forEach(el => el.classList.remove('selected'));
  updateLernStartBtn();
});

document.getElementById('btn-lernen-start').addEventListener('click', () => {
  const karten = studenten.filter(s => getSelectedGids().includes(s.gruppeId));
  if (!karten.length) return;
  document.getElementById('lernen-auswahl').classList.add('hidden');
  starteSession(karten);
});

// Foto klicken = Gewusst → weiter
document.getElementById('lernkarte').addEventListener('click', () => {
  const s = lernKarten[lernIndex];
  if (!answeredIds.has(s.id)) {
    gewusst++;
    gewusstIds.add(s.id);
    answeredIds.add(s.id);
  }
  naechsteKarteOderEnde();
});

// Button: Name zeigen ODER Weiter (je nach Zustand)
document.getElementById('btn-aufdecken').addEventListener('click', e => {
  e.stopPropagation();
  if (!nameVisible) {
    zeigeName();
  } else {
    naechsteKarteOderEnde();
  }
});

// Pfeile: Navigation ohne Wertung
document.getElementById('btn-weiter').addEventListener('click', () => {
  if (lernIndex < lernKarten.length - 1) { lernIndex++; zeigeKarte(); }
});
document.getElementById('btn-zurueck').addEventListener('click', () => {
  if (lernIndex > 0) { lernIndex--; zeigeKarte(); }
});

document.getElementById('btn-mischen').addEventListener('click', () => {
  mischen(lernKarten);
  lernIndex = 0;
  zeigeKarte();
  toast('Karten gemischt');
});

document.getElementById('btn-beenden').addEventListener('click', () => {
  document.getElementById('lernen-flashcard').classList.add('hidden');
  document.getElementById('lernen-auswahl').classList.remove('hidden');
  renderLernAuswahl();
});

// Ende-Screen Buttons
document.getElementById('btn-neue-uebung').addEventListener('click', () => {
  document.getElementById('lernen-ende').classList.add('hidden');
  starteSession(lernKarten); // gleiche Karten, neu gemischt
});

document.getElementById('btn-ende-auswahl').addEventListener('click', () => {
  document.getElementById('lernen-ende').classList.add('hidden');
  document.getElementById('lernen-auswahl').classList.remove('hidden');
  renderLernAuswahl();
});

// Tastatur (Desktop)
document.addEventListener('keydown', e => {
  if (!document.getElementById('lernen-flashcard').classList.contains('hidden')) {
    if (e.key === 'ArrowRight') document.getElementById('btn-weiter').click();
    if (e.key === 'ArrowLeft')  document.getElementById('btn-zurueck').click();
    if (e.key === ' ')          { e.preventDefault(); document.getElementById('btn-aufdecken').click(); }
  }
});

// ============================================================
// EVENTS – STATISTIK
// ============================================================

document.getElementById('btn-statistik-loeschen').addEventListener('click', async () => {
  if (!confirm('Alle Statistikdaten löschen? Die Karten bleiben erhalten.')) return;
  await dbClear('sitzungen');
  renderStatistik();
  toast('Statistik gelöscht');
});

// ============================================================
// EVENTS – SICHERUNG
// ============================================================

document.getElementById('btn-export').addEventListener('click', exportDaten);
document.getElementById('btn-import-trigger').addEventListener('click', () =>
  document.getElementById('input-import').click());
document.getElementById('input-import').addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;
  if (!confirm('Alle vorhandenen Karten werden durch den Import ersetzt. Fortfahren?')) return;
  await importDaten(file);
  e.target.value = '';
});

// ============================================================
// SERVICE WORKER
// ============================================================

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// ============================================================
// INIT
// ============================================================

(async () => {
  await dbInit();
  await ladeAlles();
  renderVerwaltung();
})();
