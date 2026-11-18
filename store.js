// Capa de datos: Firebase Firestore (compartido en tiempo real)
// o modo demo local (localStorage) si no hay configuración.
import { firebaseConfig, USUARIO } from "./config.js";

const FB = "https://www.gstatic.com/firebasejs/10.12.2/";
const COL = "invitados";
const SES = "sesiones";
const nameId = (n) => String(n).trim().replace(/\//g, "-") || "_";

export const isDemo = !firebaseConfig.apiKey;

export async function createStore() {
  return isDemo ? createLocalStore() : createFirebaseStore();
}

// ---------- Firebase ----------
async function createFirebaseStore() {
  const { initializeApp } = await import(FB + "firebase-app.js");
  const fs = await import(FB + "firebase-firestore.js");
  const au = await import(FB + "firebase-auth.js");
  const app = initializeApp(firebaseConfig);
  const auth = au.getAuth(app);
  // Espera a saber si este teléfono ya inició sesión antes.
  let user = await new Promise((res) => { const off = au.onAuthStateChanged(auth, (u) => { off(); res(u); }); });
  const db = fs.initializeFirestore(app, {
    localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
  });
  const col = fs.collection(db, COL);
  const ses = fs.collection(db, SES);

  return {
    // ----- Nombres apartados: un nombre = un teléfono -----
    watchNames(cb) {
      return fs.onSnapshot(ses, (snap) => {
        const m = {};
        snap.docs.forEach((d) => { const x = d.data(); m[x.nombre || d.id] = x; });
        cb(m, { fromCache: snap.metadata.fromCache });
      }, () => {});
    },
    // Transacción: si otro teléfono ya lo tiene, falla con code "ocupado".
    async claimName(nombre, device) {
      const ref = fs.doc(ses, nameId(nombre));
      await fs.runTransaction(db, async (t) => {
        const s = await t.get(ref);
        if (s.exists() && s.data().device !== device) throw Object.assign(new Error("ocupado"), { code: "ocupado" });
        t.set(ref, { nombre, device, desde: s.exists() ? s.data().desde : Date.now() });
      });
    },
    // device = null → liberar a la fuerza (desde ⚙).
    async releaseName(nombre, device) {
      const ref = fs.doc(ses, nameId(nombre));
      if (device) { const s = await fs.getDoc(ref); if (!s.exists() || s.data().device !== device) return; }
      await fs.deleteDoc(ref);
    },

    get loggedIn() { return !!user; },
    async login(password) {
      const cred = await au.signInWithEmailAndPassword(auth, USUARIO, password);
      user = cred.user;
    },
    async logout() { await au.signOut(auth); user = null; },
    subscribe(cb) {
      return fs.onSnapshot(col, { includeMetadataChanges: true }, (snap) => {
        const rows = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
          _pendiente: d.metadata.hasPendingWrites,
        }));
        cb(rows, { fromCache: snap.metadata.fromCache });
      }, (err) => cb(null, { error: err }));
    },
    // updateDoc (y no transacción) para que funcione aunque se caiga la señal:
    // se guarda en el teléfono y se sincroniza en cuanto vuelve el internet.
    deliver(id, por, recibio) {
      return fs.updateDoc(fs.doc(db, COL, id), {
        entregado: true, entregadoPor: por, recibidoPor: recibio || "", hora: Date.now(),
      });
    },
    undo(id) {
      return fs.updateDoc(fs.doc(db, COL, id), {
        entregado: false, entregadoPor: "", recibidoPor: "", hora: 0,
      });
    },
    async replaceAll(rows) {
      const snap = await fs.getDocs(col);
      const ops = [];
      snap.docs.forEach((d) => ops.push((b) => b.delete(d.ref)));
      rows.forEach((r) => ops.push((b) => b.set(fs.doc(col), blank(r))));
      for (let i = 0; i < ops.length; i += 400) {
        const batch = fs.writeBatch(db);
        ops.slice(i, i + 400).forEach((op) => op(batch));
        await batch.commit();
      }
    },
    async addRows(rows) {
      for (let i = 0; i < rows.length; i += 400) {
        const batch = fs.writeBatch(db);
        rows.slice(i, i + 400).forEach((r) => batch.set(fs.doc(col), blank(r)));
        await batch.commit();
      }
    },
    async resetDeliveries() {
      const snap = await fs.getDocs(col);
      for (let i = 0; i < snap.docs.length; i += 400) {
        const batch = fs.writeBatch(db);
        snap.docs.slice(i, i + 400).forEach((d) =>
          batch.update(d.ref, { entregado: false, entregadoPor: "", recibidoPor: "", hora: 0 }));
        await batch.commit();
      }
    },
  };
}

// ---------- Modo demo (sólo este navegador) ----------
function createLocalStore() {
  const KEY = "boda-demo-invitados";
  const chan = "BroadcastChannel" in window ? new BroadcastChannel(KEY) : null;
  const listeners = new Set();
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } };
  const write = (rows) => {
    try { localStorage.setItem(KEY, JSON.stringify(rows)); } catch {}
    emit(); chan?.postMessage("x");
  };
  const emit = () => listeners.forEach((cb) => cb(read(), {}));
  chan && chan.addEventListener("message", emit);
  window.addEventListener("storage", (e) => e.key === KEY && emit());
  const patch = (id, p) => write(read().map((r) => (r.id === id ? { ...r, ...p } : r)));
  // Nombres apartados (demo): compartidos entre pestañas de este navegador.
  const SKEY = "boda-demo-sesiones";
  const nameL = new Set();
  const readS = () => { try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch { return {}; } };
  const writeS = (m) => { try { localStorage.setItem(SKEY, JSON.stringify(m)); } catch {} emitS(); chan?.postMessage("s"); };
  const emitS = () => nameL.forEach((cb) => cb(readS(), {}));
  chan && chan.addEventListener("message", emitS);
  window.addEventListener("storage", (e) => e.key === SKEY && emitS());

  return {
    watchNames(cb) { nameL.add(cb); cb(readS(), {}); return () => nameL.delete(cb); },
    async claimName(nombre, device) {
      const m = readS();
      if (m[nombre] && m[nombre].device !== device) throw Object.assign(new Error("ocupado"), { code: "ocupado" });
      m[nombre] = { nombre, device, desde: m[nombre]?.desde || Date.now() }; writeS(m);
    },
    async releaseName(nombre, device) {
      const m = readS();
      if (!m[nombre] || (device && m[nombre].device !== device)) return;
      delete m[nombre]; writeS(m);
    },
    loggedIn: true,
    async login() {},
    async logout() {},
    subscribe(cb) { listeners.add(cb); cb(read(), {}); return () => listeners.delete(cb); },
    async deliver(id, por, recibio) { patch(id, { entregado: true, entregadoPor: por, recibidoPor: recibio || "", hora: Date.now() }); },
    async undo(id) { patch(id, { entregado: false, entregadoPor: "", recibidoPor: "", hora: 0 }); },
    async replaceAll(rows) { write(rows.map((r, i) => ({ id: "d" + i + "-" + Date.now(), ...blank(r) }))); },
    async addRows(rows) { write([...read(), ...rows.map((r, i) => ({ id: "a" + i + "-" + Date.now(), ...blank(r) }))]); },
    async resetDeliveries() { write(read().map((r) => ({ ...r, entregado: false, entregadoPor: "", recibidoPor: "", hora: 0 }))); },
  };
}

function blank(r) {
  return {
    familia: String(r.familia).trim(), nombre: String(r.nombre).trim(), sobre: r.sobre || "merch",
    numero: r.numero || "", orden: r.orden ?? 0, mesa: r.mesa || "",
    entregado: false, entregadoPor: "", recibidoPor: "", hora: 0,
  };
}
