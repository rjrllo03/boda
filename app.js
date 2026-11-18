import { ENTREGADORES, ADMIN_PIN, TITULO } from "./config.js";
import { createStore, isDemo } from "./store.js";

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const hora = (t) => t ? new Date(t).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }) : "";

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch {} },
};

let rows = [];
let filtro = "pend";
let quien = ls.get("boda-quien") || "";
let actual = null;

document.title = TITULO;
$("#titulo").textContent = TITULO;
$("#demo").hidden = !isDemo;

const store = await createStore();

// ---------- Acceso con contraseña compartida ----------
if (!store.loggedIn) {
  await new Promise((done) => {
    const dlg = $("#dlgLogin"), err = $("#loginError"), btn = $("#loginBtn");
    dlg.addEventListener("cancel", (e) => e.preventDefault()); // no se puede cerrar con Esc
    $("#loginForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      err.textContent = ""; btn.disabled = true; btn.textContent = "Entrando…";
      try { await store.login($("#loginPass").value); dlg.close(); done(); }
      catch (ex) {
        err.textContent = /invalid|wrong|credential|password/i.test(ex.code || "") ? "Contraseña incorrecta." :
          /too-many/i.test(ex.code || "") ? "Demasiados intentos. Espera un momento." :
          /network/i.test(ex.code || "") ? "Sin internet. Revisa la conexión." :
          /configuration-not-found|operation-not-allowed/i.test(ex.code || "") ? "Falta activar Email/Password en Firebase Authentication." : "No se pudo entrar (" + (ex.code || ex.message) + ")";
      } finally { btn.disabled = false; btn.textContent = "Entrar"; }
    });
    dlg.showModal();
    $("#loginPass").focus();
  });
}

// ---------- Quién entrega ----------
// El nombre queda fijo; sólo se cambia cerrando sesión (⚙ → Cerrar sesión).
function pintarQuien() {
  $("#quienSoy").textContent = quien ? `Entregando: ${quien}` : "Elegir quién entrega";
  $("#quienSoy").disabled = !!quien;
}
// Cada nombre sólo puede estar en un teléfono a la vez (se aparta en Firebase).
let device = ls.get("boda-device");
if (!device) { device = Math.random().toString(36).slice(2) + Date.now().toString(36); ls.set("boda-device", device); }
let ocupados = {};       // nombre → { device, desde }
let apartado = false;    // true cuando ya confirmamos que el nombre es de este teléfono
const enOtro = (n) => ocupados[n] && ocupados[n].device !== device;

function pintarBotonesQuien() {
  $("#entregadores").innerHTML = ENTREGADORES.map((n) => enOtro(n)
    ? `<button type="button" disabled>${esc(n)}<small>en uso</small></button>`
    : `<button value="${esc(n)}">${esc(n)}</button>`).join("");
}
function pedirQuien() {
  pintarBotonesQuien();
  $("#otroNombre").value = "";
  $("#dlgQuien").returnValue = "";
  if (!$("#dlgQuien").open) $("#dlgQuien").showModal();
}
function soltarQuien() { quien = ""; apartado = false; try { localStorage.removeItem("boda-quien"); } catch {} pintarQuien(); }

async function apartar(nombre) {
  try {
    await store.claimName(nombre, device);
    quien = nombre; apartado = true; ls.set("boda-quien", quien); pintarQuien();
    return true;
  } catch (ex) {
    await avisar(ex.code === "ocupado"
      ? `"${nombre}" ya está en uso en otro teléfono. Elige otro nombre o pide que liberen ese nombre en ⚙.`
      : /permission/i.test(ex.code || ex.message) ? "Firebase no dejó apartar el nombre: falta actualizar las reglas (colección «sesiones»)."
      : "No se pudo apartar el nombre (¿hay internet?). Intenta de nuevo.");
    return false;
  }
}

$("#dlgQuien").addEventListener("close", async () => {
  const v = $("#dlgQuien").returnValue;
  const nombre = (v === "otro" ? $("#otroNombre").value.trim() : v) || "";
  if (!nombre || !(await apartar(nombre))) setTimeout(pedirQuien, 50);
});
$("#quienSoy").onclick = () => { if (!quien) pedirQuien(); };

store.watchNames((m, meta) => {
  ocupados = m || {};
  if ($("#dlgQuien").open) pintarBotonesQuien();
  pintarNombresAdmin();
  // Si liberaron mi nombre desde ⚙ (o lo tomó otro teléfono), pedir nombre otra vez.
  if (apartado && quien && !meta.fromCache && (!ocupados[quien] || enOtro(quien))) {
    soltarQuien();
    avisar("Tu nombre fue liberado desde otro teléfono. Elige tu nombre otra vez.").then(pedirQuien);
  }
});

pintarQuien();
if (quien) {
  // Ya tenía nombre guardado: confirmar que sigue siendo de este teléfono.
  store.claimName(quien, device).then(() => { apartado = true; }).catch((ex) => {
    if (ex.code !== "ocupado") return; // sin internet: seguimos con el nombre guardado
    const n = quien; soltarQuien();
    avisar(`"${n}" ya está en uso en otro teléfono. Elige tu nombre.`).then(pedirQuien);
  });
} else pedirQuien();

// ---------- Datos en vivo ----------
store.subscribe((data, meta) => {
  if (!data) { toast("Error de conexión: " + (meta.error?.message || "")); return; }
  rows = data;
  const est = $("#estado");
  est.className = "estado " + (isDemo ? "" : meta.fromCache || !navigator.onLine ? "off" : "on");
  est.title = isDemo ? "Modo demo" : meta.fromCache ? "Sin conexión — se sincroniza al volver" : "Conectado";
  render();
});
window.addEventListener("online", render);
window.addEventListener("offline", () => { $("#estado").className = "estado off"; });

// ---------- Render ----------
function render() {
  const jefes = rows.filter((r) => r.jefe), otros = rows.filter((r) => !r.jefe);
  const cnt = (a) => a.filter((r) => r.entregado).length;
  $("#statSobres").textContent = `${cnt(jefes)}/${jefes.length}`;
  $("#statFolders").textContent = `${cnt(otros)}/${otros.length}`;
  $("#statTotal").textContent = rows.length ? Math.round((cnt(rows) / rows.length) * 100) + "%" : "0%";

  const q = norm($("#buscar").value.trim());
  const fams = new Map();
  [...rows]
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
    .forEach((r) => { if (!fams.has(r.familia)) fams.set(r.familia, []); fams.get(r.familia).push(r); });

  let html = "";
  for (const [fam, gente] of fams) {
    const famMatch = q && norm(fam).includes(q);
    let vis = gente.filter((r) => !q || famMatch || norm(r.nombre).includes(q) || norm(r.recibidoPor).includes(q));
    if (filtro === "pend") vis = vis.filter((r) => !r.entregado);
    if (filtro === "ent") vis = vis.filter((r) => r.entregado);
    if (!vis.length) continue;
    vis.sort((a, b) => (b.jefe - a.jefe) || (a.orden ?? 0) - (b.orden ?? 0));
    const mesa = gente.find((r) => r.mesa)?.mesa;
    html += `<section class="familia">
      <div class="familia-h"><strong>${esc(fam)}</strong><span>${mesa ? "Mesa " + esc(mesa) + " · " : ""}${cnt(gente)}/${gente.length}</span></div>
      ${vis.map(persona).join("")}
    </section>`;
  }
  $("#lista").innerHTML = html || `<p class="vacio">${rows.length ? (filtro === "pend" && !q ? "🎉 ¡Todo entregado!" : "Sin resultados") : "La lista está vacía. Ábrela en ⚙ para importar invitados."}</p>`;
}

function persona(r) {
  const badge = r.jefe ? `<span class="badge sobre">SOBRE</span>` : `<span class="badge folder">FOLDER</span>`;
  if (r.entregado) {
    const rec = r.recibidoPor && norm(r.recibidoPor) !== norm(r.nombre) ? ` · recibió ${esc(r.recibidoPor)}` : "";
    return `<div class="persona hecho ${r.jefe ? "jefe" : ""}">
      <div class="info"><div class="nombre">✓ ${esc(r.nombre)} ${badge}</div>
      <div class="meta">${esc(r.entregadoPor)} · ${hora(r.hora)}${rec}${r._pendiente ? ' · <span class="sync">sincronizando…</span>' : ""}</div></div>
      <button class="btn-undo" data-undo="${esc(r.id)}">Deshacer</button></div>`;
  }
  return `<div class="persona ${r.jefe ? "jefe" : ""}">
    <div class="info"><div class="nombre">${esc(r.nombre)} ${badge}</div>
    <div class="meta">${r.jefe ? "Jefe de familia" : "Familiar"}</div></div>
    <button class="btn-ent" data-ent="${esc(r.id)}">Entregar</button></div>`;
}

$("#buscar").addEventListener("input", render);
document.querySelectorAll(".filtros button").forEach((b) => b.onclick = () => {
  document.querySelectorAll(".filtros button").forEach((x) => x.classList.toggle("on", x === b));
  filtro = b.dataset.f; render();
});

// ---------- Entregar / deshacer ----------
$("#lista").addEventListener("click", async (e) => {
  const ent = e.target.closest("[data-ent]"), und = e.target.closest("[data-undo]");
  if (ent) {
    if (!quien) return pedirQuien();
    actual = rows.find((r) => r.id === ent.dataset.ent);
    if (!actual) return;
    $("#entFamilia").textContent = actual.familia;
    $("#entNombre").textContent = actual.nombre;
    $("#entTipo").textContent = actual.jefe ? "Entregar SOBRE (jefe de familia)" : "Entregar FOLDER";
    $("#entRecibio").value = actual.nombre;
    $("#dlgEntregar").returnValue = "";
    $("#dlgEntregar").showModal();
  }
  if (und) {
    const r = rows.find((x) => x.id === und.dataset.undo);
    if (r && await ask(`¿Marcar a ${r.nombre} como NO entregado? (Lo entregó ${r.entregadoPor})`, { ok: "Sí, deshacer", danger: true })) store.undo(r.id);
  }
});

$("#dlgEntregar").addEventListener("close", async () => {
  if ($("#dlgEntregar").returnValue !== "ok" || !actual) return;
  const r = actual; actual = null;
  const ya = rows.find((x) => x.id === r.id);
  if (ya?.entregado) { toast(`Ya lo había entregado ${ya.entregadoPor}`); return; }
  try {
    store.deliver(r.id, quien, $("#entRecibio").value.trim()).catch((err) => toast("No se guardó: " + err.message));
    toast(`✓ ${r.nombre}`, () => store.undo(r.id));
  } catch (err) { toast("No se guardó: " + err.message); }
});

// ---------- Diálogos propios (algunos navegadores bloquean confirm/prompt/alert) ----------
// Devuelve: true/false (confirmar), el texto escrito (con input) o null si cancela.
function ask(msg, { input = false, ok = "Aceptar", cancel = "Cancelar", danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = $("#dlgAsk"), inp = $("#askInput"), okBtn = $("#askOk"), noBtn = $("#askNo");
    $("#askMsg").textContent = msg;
    inp.hidden = !input; inp.value = "";
    okBtn.textContent = ok; okBtn.classList.toggle("danger-bg", danger);
    noBtn.hidden = !cancel; noBtn.textContent = cancel || "";
    dlg.returnValue = "";
    dlg.onclose = () => {
      const yes = dlg.returnValue === "ok";
      resolve(input ? (yes ? inp.value : null) : yes);
    };
    dlg.showModal();
    if (input) inp.focus();
  });
}
function avisar(msg) { return ask(msg, { cancel: false }); }

// ---------- Toast ----------
let toastT;
function toast(msg, undo) {
  const t = $("#toast");
  t.innerHTML = `<span>${esc(msg)}</span>` + (undo ? `<button>Deshacer</button>` : "");
  if (undo) t.querySelector("button").onclick = () => { undo(); t.hidden = true; };
  t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 4000);
}

// ---------- Admin ----------
$("#btnAdmin").onclick = async () => {
  let ok = false;
  try { ok = sessionStorage.getItem("boda-admin") === "1"; } catch {}
  if (!ok) {
    const pin = await ask("PIN de administración", { input: true, ok: "Entrar" });
    if (pin !== ADMIN_PIN) { if (pin !== null) await avisar("PIN incorrecto"); return; }
    try { sessionStorage.setItem("boda-admin", "1"); } catch {}
  }
  $("#dlgAdmin").showModal();
};

function parse(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const sep = lines.some((l) => l.includes("\t")) ? "\t" : lines.some((l) => l.includes(";")) ? ";" : ",";
  let data = lines.map((l) => l.split(sep).map((c) => c.trim().replace(/^"|"$/g, "")));
  if (data.length && /familia/i.test(data[0][0]) && /nombre/i.test(data[0][1] || "")) data.shift(); // encabezados
  const tieneJefe = data.some((c) => c[2] && /^(s[ií]|si|yes|x|1|true|jefe|no|0|false)$/i.test(c[2]));
  const vistos = new Set();
  return data.filter((c) => c[0] && c[1]).map((c, i) => {
    let jefe;
    if (tieneJefe) jefe = /^(s[ií]|si|yes|x|1|true|jefe)$/i.test(c[2] || "");
    else { jefe = !vistos.has(c[0]); vistos.add(c[0]); }
    return { familia: c[0], nombre: c[1], jefe, mesa: c[3] || "", orden: i };
  });
}

$("#csv").addEventListener("input", () => {
  const p = parse($("#csv").value);
  const fams = new Set(p.map((r) => r.familia)).size;
  $("#preview").textContent = p.length ? `${p.length} invitados · ${fams} familias · ${p.filter((r) => r.jefe).length} sobres` : "";
});

$("#btnEjemplo").onclick = () => {
  $("#csv").value = [
    "Familia García\tJuan García\tsí\t1", "Familia García\tAna López\tno\t1", "Familia García\tSofía García\tno\t1",
    "Familia Pérez\tLuis Pérez\tsí\t2", "Familia Pérez\tMarta Ruiz\tno\t2",
    "Familia Hernández\tCarlos Hernández\tsí\t3", "Familia Hernández\tLucía Hernández\tno\t3",
    "Familia Hernández\tDiego Hernández\tno\t3", "Familia Hernández\tElena Torres\tno\t3",
  ].join("\n");
  $("#csv").dispatchEvent(new Event("input"));
};

$("#btnImport").onclick = async () => {
  const p = parse($("#csv").value);
  if (!p.length) return avisar("No encontré invitados. Revisa el formato.");
  if (!await ask(`Esto BORRA la lista actual (y sus entregas) y carga ${p.length} invitados. ¿Continuar?`, { ok: "Sí, reemplazar", danger: true })) return;
  try { await store.replaceAll(p); toast(`Lista cargada: ${p.length} invitados`); $("#csv").value = ""; $("#preview").textContent = ""; }
  catch (err) { avisar("Error: " + err.message); }
};

$("#btnLogout").onclick = async () => {
  if (!await ask("¿Cerrar sesión en este teléfono? Se pedirá la contraseña y el nombre otra vez.", { ok: "Cerrar sesión" })) return;
  if (quien) { try { await store.releaseName(quien, device); } catch {} }
  try { localStorage.removeItem("boda-quien"); } catch {}
  await store.logout(); location.reload();
};

// ---------- Nombres en uso (⚙) ----------
function pintarNombresAdmin() {
  const box = $("#nombresUso");
  if (!box) return;
  const lista = Object.entries(ocupados);
  box.innerHTML = lista.length ? lista.map(([n, x]) => `<div class="uso">
      <span><strong>${esc(n)}</strong>${x.device === device ? " (este teléfono)" : ""}<br><small>desde ${hora(x.desde)}</small></span>
      <button type="button" class="ghost danger" data-liberar="${esc(n)}">Liberar</button></div>`).join("")
    : `<p class="muted">Ningún nombre en uso.</p>`;
}
$("#nombresUso").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-liberar]");
  if (!b) return;
  const n = b.dataset.liberar;
  if (!await ask(`¿Liberar "${n}"? El teléfono que lo usa tendrá que elegir nombre otra vez.`, { ok: "Liberar", danger: true })) return;
  try { await store.releaseName(n, null); toast(`"${n}" liberado`); } catch (err) { avisar("Error: " + err.message); }
});

$("#btnReset").onclick = async () => {
  if (!await ask("¿Desmarcar TODAS las entregas? La lista se queda igual.", { ok: "Sí, desmarcar", danger: true })) return;
  await store.resetDeliveries(); toast("Entregas reiniciadas");
};

$("#btnExport").onclick = () => {
  const head = ["Familia", "Nombre", "Tipo", "Entregado", "Entregó", "Recibió", "Hora"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const body = [...rows].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)).map((r) =>
    [r.familia, r.nombre, r.jefe ? "Sobre" : "Folder", r.entregado ? "Sí" : "No", r.entregadoPor, r.recibidoPor, r.hora ? new Date(r.hora).toLocaleString("es-MX") : ""].map(q).join(","));
  const blob = new Blob(["﻿" + [head.join(","), ...body].join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "registro-regalos.csv"; a.click();
};
