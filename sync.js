// Sincronización multiusuario con Firebase (Google Auth + Firestore).
// - Solo entran los correos aprobados por el administrador (lo hacen cumplir las reglas de firestore.rules).
// - Cada usuario solo ve sus propios datos.
// Estructura:
//   users/{uid}/picks/{pickId}             -> un pick
//   users/{uid}/lines/{gameId|parámetro}   -> { line, hist:[…], updated }
//   users/{uid}/meta/state                 -> { manual:[…] }
//   config/access                          -> { allowed:[correos] }        (solo admin)
//   requests/{uid}                         -> { email, name, ts }          (solicitudes de acceso)
const FBV = '10.12.2';
const J = window.JAM;
const cfg = window.FIREBASE_CONFIG;
const ADMINS = (window.APP_ADMINS || []).map(e => String(e).toLowerCase());

const clean = o => JSON.parse(JSON.stringify(o ?? null)); // Firestore no acepta undefined
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const denied = e => /permission|insufficient/i.test(e?.code || e?.message || '');
const LAST = 'nbajam.lastUid';
const getLast = () => { try { return localStorage.getItem(LAST); } catch { return null; } };
const setLast = v => { try { v ? localStorage.setItem(LAST, v) : localStorage.removeItem(LAST); } catch {} };

async function loadFirebase() {
  if (window.__FB_MOCK) return window.__FB_MOCK; // solo para pruebas
  const base = `https://www.gstatic.com/firebasejs/${FBV}`;
  const [app, auth, fs] = await Promise.all([
    import(`${base}/firebase-app.js`), import(`${base}/firebase-auth.js`), import(`${base}/firebase-firestore.js`),
  ]);
  return { ...app, ...auth, ...fs };
}

let adminBadge = 0;
function ui(state, extra = '') {
  const adminBtn = state === 'on' && ADMINS.includes(String(extra.email || '').toLowerCase())
    ? `<button id="syncAdmin">Usuarios${adminBadge ? ` <b class="badge-n">${adminBadge}</b>` : ''}</button>` : '';
  const map = {
    off: `<span class="who" title="Edita firebase-config.js para activar la sincronización">☁ sin nube</span>`,
    out: `<button id="syncIn">Entrar con Google</button>`,
    busy: `<span class="who">☁ conectando…</span>`,
    on: `<span class="ok" title="Tus líneas y picks se guardan en tu cuenta">☁</span><span class="who">${esc(extra.name)}</span>${adminBtn}<button id="syncOut">Salir</button>`,
    pending: `<span class="who" title="Se envió tu solicitud al administrador. Mientras, lo que captures se queda solo en este navegador.">⏳ acceso pendiente · ${esc(extra.email)}</span><button id="syncOut">Salir</button>`,
    err: `<span class="who" style="color:var(--under)" title="${esc(extra.msg)}">☁ error de conexión</span><button id="syncIn">Reintentar</button>`,
  };
  J.setSync(map[state]);
}

if (!J) {
  console.warn('sync.js: la app no expuso window.JAM');
} else if (!cfg && !window.__FB_MOCK) {
  ui('off');
} else {
  start().catch(e => { console.error(e); ui('err', { msg: e.message }); });
}

async function start() {
  const fb = await loadFirebase();
  const app = fb.initializeApp(cfg || {});
  const auth = fb.getAuth(app);
  const db = fb.getFirestore(app);
  const { S, Sync, store, pickId } = J;
  let uid = null, me = null, unsubs = [], adminUnsub = null;

  const signIn = async () => {
    const provider = new fb.GoogleAuthProvider();
    provider.setCustomParameters?.({ prompt: 'select_account' }); // permite escoger cuenta si hay varias
    try { await fb.signInWithPopup(auth, provider); }
    catch (e) {
      if (/popup/i.test(e.code || e.message)) await fb.signInWithRedirect(auth, provider);
      else ui('err', { msg: e.message });
    }
  };
  const signOut = async () => {
    J.resetUserData();   // borra la copia local para que el siguiente usuario no vea nada
    setLast(null);
    await fb.signOut(auth);
  };
  document.addEventListener('click', e => {
    const id = e.target.closest('button')?.id;
    if (id === 'syncIn') signIn();
    if (id === 'syncOut') signOut();
    if (id === 'syncAdmin') openAdmin();
  });
  try { await fb.getRedirectResult?.(auth); } catch {}

  const P = (...seg) => fb.doc(db, 'users', uid, ...seg);
  const C = (...seg) => fb.collection(db, 'users', uid, ...seg);
  const fail = e => {
    console.error('sync', e);
    if (denied(e)) { disable(); ui('pending', me); } else ui('err', { msg: e.message });
  };

  function enable() {
    Sync.on = true;
    Sync.savePick = p => fb.setDoc(P('picks', pickId(p)), clean(p)).catch(fail);
    Sync.deletePick = id => id && fb.deleteDoc(P('picks', id)).catch(fail);
    Sync.saveLine = key => {
      const line = S.lines[key] ?? null, hist = S.hist[key] || [], odds = S.odds[key] || null;
      if (line == null && !hist.length && !odds) return fb.deleteDoc(P('lines', key)).catch(fail);
      return fb.setDoc(P('lines', key), clean({ line, hist, odds, updated: Date.now() })).catch(fail);
    };
    Sync.saveManual = () => fb.setDoc(P('meta', 'state'), clean({ manual: S.manual }), { merge: true }).catch(fail);
  }
  function disable() {
    Sync.on = false;
    Sync.savePick = Sync.deletePick = Sync.saveLine = Sync.saveManual = () => {};
    unsubs.forEach(u => u()); unsubs = [];
    adminUnsub?.(); adminUnsub = null;
  }

  // Une lo que había en este navegador con lo que hay en la nube (no se pierde nada)
  async function merge(cp, cl, cm) {
    const cloudPicks = new Set(cp.docs.map(d => d.id));
    const writes = [];
    for (const p of S.picks) if (!cloudPicks.has(pickId(p))) writes.push(fb.setDoc(P('picks', pickId(p)), clean(p)));

    const cloudLines = Object.fromEntries(cl.docs.map(d => [d.id, d.data()]));
    for (const key of new Set([...Object.keys(S.lines), ...Object.keys(S.hist), ...Object.keys(S.odds)])) {
      const r = cloudLines[key] || { line: null, hist: [], updated: 0 };
      const lh = S.hist[key] || [];
      const byTs = new Map([...(r.hist || []), ...lh].map(x => [x.ts, x]));
      const hist = [...byTs.values()].sort((a, b) => a.ts - b.ts);
      const localUpd = lh.length ? Math.max(...lh.map(x => x.ts)) : 0;
      const localWins = localUpd >= (r.updated || 0);
      const line = localWins ? (S.lines[key] ?? r.line ?? null) : r.line;
      const odds = localWins ? (S.odds[key] || r.odds || null) : (r.odds || S.odds[key] || null);
      if (line !== r.line || hist.length !== (r.hist || []).length || JSON.stringify(odds) !== JSON.stringify(r.odds || null))
        writes.push(fb.setDoc(P('lines', key), clean({ line, hist, odds, updated: Math.max(localUpd, r.updated || 0) })));
    }

    const cloudManual = (cm.exists() && cm.data().manual) || [];
    const seen = new Set(cloudManual.map(x => x.h + x.a));
    const manual = [...cloudManual, ...S.manual.filter(x => !seen.has(x.h + x.a))];
    if (manual.length !== cloudManual.length) writes.push(fb.setDoc(P('meta', 'state'), clean({ manual }), { merge: true }));
    await Promise.all(writes);
  }

  // Escucha cambios (de este u otro dispositivo del mismo usuario)
  function listen() {
    unsubs.push(fb.onSnapshot(C('picks'), snap => {
      S.picks = snap.docs.map(d => d.data()).sort((a, b) => String(a.created).localeCompare(String(b.created)));
      store.set('picks', S.picks); J.rerender();
    }, fail));
    unsubs.push(fb.onSnapshot(C('lines'), snap => {
      const lines = {}, hist = {}, odds = {};
      for (const d of snap.docs) { const x = d.data(); if (x.line != null) lines[d.id] = x.line; if (x.hist?.length) hist[d.id] = x.hist; if (x.odds) odds[d.id] = x.odds; }
      S.lines = lines; S.hist = hist; S.odds = odds;
      store.set('lines', lines); store.set('hist', hist); store.set('odds', odds); J.rerender();
    }, fail));
    unsubs.push(fb.onSnapshot(P('meta', 'state'), snap => {
      if (!snap.exists()) return;
      S.manual = snap.data().manual || []; store.set('manual', S.manual); J.rerender();
    }, fail));
  }

  fb.onAuthStateChanged(auth, async user => {
    disable();
    if (!user) { uid = null; me = null; ui('out'); return; }
    uid = user.uid;
    me = { name: user.displayName || user.email || '', email: (user.email || '').toLowerCase() };
    ui('busy');
    // Si en este navegador estaba otra cuenta, no mezclar sus datos con los de esta
    const last = getLast();
    if (last && last !== uid) J.resetUserData();
    let cp, cl, cm;
    try {
      [cp, cl, cm] = await Promise.all([fb.getDocs(C('picks')), fb.getDocs(C('lines')), fb.getDoc(P('meta', 'state'))]);
    } catch (e) {
      if (!denied(e)) return fail(e);
      // No está aprobado: deja (o actualiza) su solicitud de acceso
      try { await fb.setDoc(fb.doc(db, 'requests', uid), { email: me.email, name: me.name, ts: Date.now() }); } catch {}
      ui('pending', me);
      return;
    }
    try {
      await merge(cp, cl, cm);
      setLast(uid);
      enable(); listen();
      ui('on', me);
      if (ADMINS.includes(me.email)) watchRequests();
    } catch (e) { fail(e); }
  });

  // ---------- Panel de administrador ----------
  function watchRequests() {
    adminUnsub = fb.onSnapshot(fb.collection(db, 'requests'), snap => {
      adminBadge = snap.docs.length; ui('on', me);
      if (dlg?.open) renderAdmin();
    }, e => console.warn('requests', e));
  }
  let dlg = null;
  function openAdmin() {
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.className = 'admin-dlg';
      dlg.addEventListener('click', onAdminClick);
      document.body.appendChild(dlg);
    }
    dlg.showModal(); renderAdmin();
  }
  async function renderAdmin() {
    dlg.innerHTML = `<div class="adm"><div class="adm-h"><h3>Usuarios</h3><button data-a="close">Cerrar</button></div><p class="note">Cargando…</p></div>`;
    let allowed = [], reqs = [];
    try {
      const [acc, rq] = await Promise.all([fb.getDoc(fb.doc(db, 'config', 'access')), fb.getDocs(fb.collection(db, 'requests'))]);
      allowed = (acc.exists() && acc.data().allowed) || [];
      reqs = rq.docs.map(d => ({ uid: d.id, ...d.data() })).sort((a, b) => b.ts - a.ts);
    } catch (e) {
      dlg.querySelector('.note').textContent = 'No se pudo leer: ' + e.message + ' (¿pusiste tu correo en firestore.rules?)';
      return;
    }
    dlg.innerHTML = `<div class="adm">
      <div class="adm-h"><h3>Usuarios</h3><button data-a="close">Cerrar</button></div>
      <h4>Solicitudes pendientes (${reqs.length})</h4>
      ${reqs.length ? `<table><tbody>${reqs.map(r => `<tr><td><b>${esc(r.name)}</b><div class="note">${esc(r.email)} · ${new Date(r.ts).toLocaleDateString('es-MX')}</div></td>
        <td class="n"><button class="primary" data-a="approve" data-uid="${esc(r.uid)}" data-email="${esc(r.email)}">Aprobar</button> <button data-a="reject" data-uid="${esc(r.uid)}">Rechazar</button></td></tr>`).join('')}</tbody></table>`
        : '<p class="note">Nadie está esperando.</p>'}
      <h4>Con acceso (${allowed.length + ADMINS.length})</h4>
      <table><tbody>
        ${ADMINS.map(e => `<tr><td>${esc(e)} <span class="pill">admin</span></td><td></td></tr>`).join('')}
        ${allowed.map(e => `<tr><td>${esc(e)}</td><td class="n"><button data-a="remove" data-email="${esc(e)}">Quitar</button></td></tr>`).join('')}
      </tbody></table>
      <form class="adm-add" data-a="add"><input type="email" required placeholder="correo@gmail.com" id="admEmail"><button class="primary">Agregar</button></form>
      <p class="note">Agrega la cuenta de Google con la que entrará. Al quitar a alguien deja de sincronizar de inmediato; sus datos se conservan por si lo vuelves a aprobar.</p>
    </div>`;
    dlg.querySelector('form').onsubmit = async ev => { ev.preventDefault(); await setAllowed(a => [...a, dlg.querySelector('#admEmail').value]); };
  }
  async function setAllowed(fn) {
    const ref = fb.doc(db, 'config', 'access');
    const snap = await fb.getDoc(ref);
    const cur = (snap.exists() && snap.data().allowed) || [];
    const next = [...new Set(fn(cur).map(e => String(e).trim().toLowerCase()).filter(Boolean))];
    await fb.setDoc(ref, { allowed: next }, { merge: true });
  }
  async function onAdminClick(e) {
    const b = e.target.closest('[data-a]'); if (!b || b.tagName === 'FORM') return;
    const a = b.dataset.a;
    try {
      if (a === 'close') return dlg.close();
      if (a === 'approve') { await setAllowed(x => [...x, b.dataset.email]); await fb.deleteDoc(fb.doc(db, 'requests', b.dataset.uid)); }
      if (a === 'reject') await fb.deleteDoc(fb.doc(db, 'requests', b.dataset.uid));
      if (a === 'remove' && confirm(`¿Quitar acceso a ${b.dataset.email}?`)) await setAllowed(x => x.filter(y => y !== b.dataset.email));
      renderAdmin();
    } catch (err) { alert('No se pudo: ' + err.message); }
  }
}
