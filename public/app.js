'use strict';

// ---------------- Permisos ----------------
const ROLES = {
  admin:        { nombre: 'Administrador',        valores: true,  editar: true,  accesos: true },
  gerencia:     { nombre: 'Gerencia / CEO',       valores: true,  editar: false, accesos: false },
  contabilidad: { nombre: 'Contabilidad',         valores: true,  editar: false, accesos: false },
  tecnico:      { nombre: 'Departamento Técnico', valores: false, editar: false, accesos: false },
};
const ACTIVOS = ['ACTIVO', 'OPERATIVA'];
const ESTADOS_CAMARA = ['ACTIVO', 'PASIVO', 'SIN CONTRATO', 'SIN MONITOREO', 'POR INGRESAR'];
const CLAVE_LOCAL = 'portal.datos';

const S = { datos: null, rol: 'admin', correo: '', local: true };
// true cuando la página se abre desde GitHub Pages (copia de solo lectura para Gerencia)
const PUBLICADO = /\.github\.io$/i.test(location.hostname);
const P = () => ROLES[S.rol] || ROLES.tecnico;

// ---------------- Utilidades ----------------
const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dinero = (n) => '$' + Number(n || 0).toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const entero = (n) => Number(n || 0).toLocaleString('es-EC');
const claseEstado = (e) => 'chip e-' + String(e || '').toLowerCase().replace(/\s+/g, '-');
const chipEstado = (e) => (e ? `<span class="${claseEstado(e)}">${esc(e)}</span>` : '<span class="vacio">—</span>');
const fecha = (f) => (f && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f.split('-').reverse().join('/') : esc(f || ''));
const normal = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.hidden = true), 4000);
}

function stats(prop) {
  const c = prop.camaras || [];
  const valCam = c.reduce((s, x) => s + (Number(x.valor) || 0), 0);
  const valSrv = (prop.servicios || []).reduce((s, x) => s + (Number(x.valor) || 0), 0);
  return {
    total: c.length,
    fijas: c.filter((x) => x.tipo === 'FIJA').length,
    ptz: c.filter((x) => x.tipo === 'PTZ').length,
    activas: c.filter((x) => ACTIVOS.includes(x.estado)).length,
    pasivas: c.filter((x) => x.estado === 'PASIVO').length,
    valor: valCam + valSrv,
  };
}
function sumar(props) {
  return props.map(stats).reduce((a, s) => {
    for (const k in s) a[k] = (a[k] || 0) + s[k];
    return a;
  }, {});
}
const grupoDe = (p) => p.grupo || 'Clientes directos';
function porGrupo(props) {
  const m = new Map();
  for (const p of props) {
    const g = grupoDe(p);
    if (!m.has(g)) m.set(g, []);
    m.get(g).push(p);
  }
  return [...m.entries()].sort((a, b) => (a[0] === 'Clientes directos') - (b[0] === 'Clientes directos') || a[0].localeCompare(b[0]));
}
const buscarProp = (id) => S.datos.propiedades.find((p) => p.id === id);

// ---------------- Carga ----------------
async function iniciar() {
  try {
    const r = PUBLICADO ? { ok: false } : await fetch('/api/sesion', { cache: 'no-store' });
    if (r.ok) {
      const s = await r.json();
      S.servidor = true;
      S.correo = s.correo;
      S.local = !!s.local; // servidor de esta computadora: permite "Ver como"
      S.rol = S.local ? (localStorage.getItem('portal.rol') || 'admin') : s.rol;
      // Si los datos no cambiaron desde la última visita, se usan los guardados en el navegador
      let enCache = null;
      try {
        const v = (await (await fetch('/api/version', { cache: 'no-store' })).json()).version;
        const c = JSON.parse(localStorage.getItem('portal.cache') || 'null');
        if (v && c && c.v === v) enCache = c;
      } catch (e) { /* sin caché */ }
      if (enCache) { S.version = enCache.v; S.datos = enCache.d; S.base = JSON.parse(JSON.stringify(enCache.d)); }
      else {
        const rd = await fetch('/api/datos', { cache: 'no-store' });
        S.version = rd.headers.get('X-Version') || '';
        const txt = await rd.text();
        S.datos = JSON.parse(txt);
        S.base = JSON.parse(txt);
        try { localStorage.setItem('portal.cache', `{"v":${JSON.stringify(S.version)},"d":${txt}}`); } catch (e) { /* sin espacio */ }
      }
      // Al volver a esta pestaña, si se guardaron cambios en otra, se cargan solos
      const refrescar = async () => {
        if (document.hidden || !$('#modal').hidden) return;
        try {
          const v = (await (await fetch('/api/version', { cache: 'no-store' })).json()).version;
          if (v && v !== S.version) { await traerDatos(); mostrar(); }
        } catch (e) { /* sin conexión: se intentará al guardar */ }
      };
      document.addEventListener('visibilitychange', refrescar);
      window.addEventListener('focus', refrescar);
      window.addEventListener('pageshow', (e) => { if (e.persisted) refrescar(); });
      if (S.local) {
        const av = $('#aviso-local');
        av.hidden = false;
        av.textContent = 'Trabajando en esta computadora: nadie más puede ver esta página todavía. Los cambios se guardan en la carpeta del proyecto. Con "Ver como" puedes comprobar lo que verá cada usuario.';
      }
    }
  } catch (e) { /* sin servidor: solo lectura de data/datos.js */ }

  if (!S.datos) {
    // Sin servidor (archivo abierto directo): recién aquí se carga la copia data/datos.js
    if (!window.DATOS) await new Promise((ok) => { const sc = document.createElement('script'); sc.src = '../data/datos.js'; sc.onload = sc.onerror = ok; document.head.appendChild(sc); });
    if (!window.DATOS) {
      $('#contenido').innerHTML = '<div class="panel"><h2>No se encontraron los datos</h2><p>Ejecuta <code>herramientas\\importar.ps1</code> para generarlos.</p></div>';
      return;
    }
    if (PUBLICADO) {
      // Copia publicada en internet para Gerencia: ve todo (con valores) y no puede editar
      S.datos = window.DATOS; S.local = false; S.rol = 'gerencia'; S.correo = '';
      window.addEventListener('hashchange', mostrar);
      mostrar();
      return;
    }
    S.local = true;
    const guardado = localStorage.getItem(CLAVE_LOCAL);
    const base = window.DATOS;
    S.datos = base;
    if (guardado) {
      try {
        const g = JSON.parse(guardado);
        if (g.generado === base.generado) S.datos = g; else localStorage.removeItem(CLAVE_LOCAL);
      } catch (e) { localStorage.removeItem(CLAVE_LOCAL); }
    }
    S.rol = localStorage.getItem('portal.rol') || 'admin';
    const av = $('#aviso-local');
    av.hidden = false;
    av.textContent = 'Revisión en esta computadora: nadie más puede ver esta página todavía. Con "Ver como" puedes comprobar lo que verá cada usuario.';
  }
  window.addEventListener('hashchange', mostrar);
  mostrar();
}

async function guardar(motivo) {
  if (!S.servidor) {
    localStorage.setItem(CLAVE_LOCAL, JSON.stringify(S.datos));
    toast('Guardado solo en este navegador: ' + motivo);
    return;
  }
  S.datos.editado = true;
  S.datos.ultimoCambio = new Date().toISOString();
  const enviar = () => fetch('/api/datos', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Motivo': encodeURIComponent(motivo), 'X-Version': S.version || '' }, body: JSON.stringify(S.datos) });
  let r = await enviar();
  for (let intento = 0; r.status === 409 && intento < 3; intento++) {
    // Se guardaron cambios en otra pestaña: se unen con los de esta y se vuelve a guardar, sin perder ninguno
    const local = S.datos;
    const base = S.base;
    await traerDatos();
    S.datos = unir(base, local, S.datos);
    r = await enviar();
  }
  if (r.ok) { S.version = r.headers.get('X-Version') || S.version; S.base = structuredClone(S.datos); }
  toast(r.ok ? 'Cambio guardado: ' + motivo : 'No se pudo guardar el cambio. Recarga la página (F5).');
  return r.ok;
}

async function traerDatos() {
  const rd = await fetch('/api/datos', { cache: 'no-store' });
  S.version = rd.headers.get('X-Version') || '';
  S.datos = await rd.json();
  S.base = structuredClone(S.datos);
}

// Unión de tres versiones: base (lo que esta pestaña cargó), local (con los cambios de esta pestaña)
// y servidor (con los cambios de otras pestañas). Gana lo que cambió cada lado; si ambos cambiaron lo mismo, gana esta pestaña.
// Se modifica "local" en el mismo objeto, para que un formulario abierto siga apuntando a los datos vigentes.
function unir(b, l, s) {
  const igual = (x, y) => x === y || JSON.stringify(x) === JSON.stringify(y);
  const esObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  const conId = (a) => Array.isArray(a) && a.every((x) => esObj(x) && x.id != null);
  if (conId(l) && conId(s) && (b == null || conId(b))) {
    const mapa = (a) => new Map((a || []).map((x) => [x.id, x]));
    const mb = mapa(b), ml = mapa(l), ms = mapa(s);
    const out = [];
    for (const x of s) {
      if (mb.has(x.id) && !ml.has(x.id)) continue; // borrado en esta pestaña
      out.push(ml.has(x.id) ? unir(mb.get(x.id), ml.get(x.id), x) : x);
    }
    for (const x of l) if (!ms.has(x.id) && !mb.has(x.id)) out.push(x); // agregado en esta pestaña
    // respetar el orden de esta pestaña (p. ej. foto principal) cuando solo esta lo cambió
    if (igual(s.map((x) => x.id), (b || []).map((x) => x.id))) out.sort((x, y) => idx(l, x) - idx(l, y));
    l.splice(0, l.length, ...out);
    return l;
  }
  if (esObj(l) && esObj(s)) {
    for (const k of new Set([...Object.keys(s), ...Object.keys(l)])) {
      const v = unir(esObj(b) ? b[k] : undefined, l[k], s[k]);
      if (v === undefined) delete l[k]; else l[k] = v;
    }
    return l;
  }
  return igual(l, b) ? s : l;
}
const idx = (a, x) => { const i = a.findIndex((y) => y.id === x.id); return i < 0 ? 1e9 : i; };

// ---------------- Fotos ----------------
const urlFoto = (ruta) => (S.servidor ? '/' : '../data/') + ruta;

function galeria(cam, inicio = 0) {
  const fotos = cam.fotos || [];
  if (!fotos.length) return;
  let i = inicio;
  const m = $('#modal');
  const pintar = () => {
    const f = fotos[i];
    m.innerHTML = `<div class="visor">
      <div class="visor-barra">
        <div><strong>${esc(cam.nombre)}</strong> <span class="vacio">· foto ${i + 1} de ${fotos.length}${f.ancho ? ` · original ${f.ancho}×${f.alto}` : ''}${f.fuente ? ' · ' + esc(f.fuente) : ''}</span></div>
        <div class="acciones"><a class="btn mini" href="${urlFoto(PUBLICADO ? f.web : f.original)}" target="_blank" rel="noopener">${PUBLICADO ? 'Abrir foto' : 'Abrir original' + (f.ancho >= 3800 ? ' 4K' : '')}</a><button class="btn mini" id="v-cerrar">Cerrar ✕</button></div>
      </div>
      <div class="visor-foto">
        ${fotos.length > 1 ? '<button class="visor-nav izq" id="v-ant" aria-label="Anterior">‹</button>' : ''}
        <img src="${urlFoto(f.web)}" alt="${esc(cam.nombre)}" decoding="async" style="background:url('${urlFoto(f.mini)}') center / contain no-repeat">
        ${fotos.length > 1 ? '<button class="visor-nav der" id="v-sig" aria-label="Siguiente">›</button>' : ''}
      </div>
      ${fotos.length > 1 ? `<div class="visor-minis">${fotos.map((x, j) => `<img src="${urlFoto(x.mini)}" data-i="${j}" class="${j === i ? 'sel' : ''}" alt="">`).join('')}</div>` : ''}
    </div>`;
    $('#v-cerrar').onclick = cerrar;
    if ($('#v-ant')) $('#v-ant').onclick = () => { i = (i - 1 + fotos.length) % fotos.length; pintar(); };
    if ($('#v-sig')) $('#v-sig').onclick = () => { i = (i + 1) % fotos.length; pintar(); };
    m.querySelectorAll('.visor-minis img').forEach((im) => (im.onclick = () => { i = Number(im.dataset.i); pintar(); }));
  };
  const tecla = (e) => {
    if (e.key === 'Escape') cerrar();
    if (e.key === 'ArrowLeft' && fotos.length > 1) { i = (i - 1 + fotos.length) % fotos.length; pintar(); }
    if (e.key === 'ArrowRight' && fotos.length > 1) { i = (i + 1) % fotos.length; pintar(); }
  };
  const cerrar = () => { m.hidden = true; m.innerHTML = ''; document.removeEventListener('keydown', tecla); };
  m.onclick = (e) => { if (e.target === m) cerrar(); };
  document.addEventListener('keydown', tecla);
  m.hidden = false;
  pintar();
}

async function subirFoto(cam, archivo) {
  const ext = (archivo.name.match(/\.[a-z0-9]+$/i) || ['.jpg'])[0].toLowerCase();
  const r = await fetch(`/api/fotos?cam=${encodeURIComponent(cam.id)}&ext=${encodeURIComponent(ext)}`, { method: 'POST', body: archivo });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'error al subir');
  return r.json();
}
async function borrarFoto(foto) {
  await fetch(`/api/fotos?id=${encodeURIComponent(foto.id)}`, { method: 'DELETE' });
}

// ---------------- Estructura ----------------
function pintarBarra(vista) {
  const items = [['resumen', 'Resumen'], ['cctv', 'CCTV'], ['gps', 'GPS'], ['costanet', 'COSTANET']];
  if (P().valores) items.push(['valores', 'Valores']);
  if (P().accesos) items.push(['accesos', 'Accesos']);
  $('#menu').innerHTML = items.map(([k, t]) => `<a href="#/${k}" class="${vista === k ? 'activo' : ''}">${t}</a>`).join('');
  if (S.local) {
    $('#usuario').innerHTML = `Ver como <select id="ver-como">${Object.entries(ROLES).map(([k, r]) => `<option value="${k}" ${k === S.rol ? 'selected' : ''}>${r.nombre}</option>`).join('')}</select>`;
    $('#ver-como').onchange = (e) => {
      S.rol = e.target.value;
      localStorage.setItem('portal.rol', S.rol);
      mostrar();
    };
  } else {
    $('#usuario').innerHTML = S.correo ? `${esc(S.correo)} · ${esc(P().nombre)}` : esc(P().nombre);
  }
}

function mostrar() {
  const [ruta, query] = (location.hash || '#/resumen').slice(2).split('?');
  const partes = ruta.split('/');
  S.params = new URLSearchParams(query || '');
  let vista = partes[0] || 'resumen';
  if (vista === 'accesos' && !P().accesos) vista = 'resumen';
  if (vista === 'valores' && !P().valores) vista = 'resumen';
  pintarBarra(vista);
  document.body.classList.toggle('tema-costanet', vista === 'costanet');
  document.body.classList.toggle('vista-cctv', vista === 'cctv');
  if (vista !== 'cctv') document.body.classList.remove('cctv-sel');
  const c = $('#contenido');
  const vistas = { resumen: vResumen, cctv: vCctv, gps: vGps, costanet: vCostanet, valores: vValores, accesos: vAccesos };
  (vistas[vista] || vResumen)(c, partes.slice(1).map(decodeURIComponent));
}

// ---------------- Resumen ----------------
function vResumen(c) {
  const props = S.datos.propiedades;
  const t = sumar(props);
  const veh = S.datos.gps.flatMap((g) => g.vehiculos);
  const valGps = veh.reduce((s, v) => s + (Number(v.valor) || 0), 0);
  const camCostanet = S.datos.costanet.reduce((s, n) => s + (n.camaras || 0), 0);
  const v = P().valores;
  const grupos = porGrupo(props);
  const gpsN = S.datos.gps.length;
  const gpsUni = S.datos.gps.reduce((s, g) => s + unidadesDe(g.vehiculos || []), 0);
  const gpsAct = S.datos.gps.reduce((s, g) => s + unidadesDe((g.vehiculos || []).filter((x) => ACTIVOS.includes(x.estado))), 0);

  c.innerHTML = `
    <div class="portada mosaico">
      <div class="mosaico-fotos">
        ${[['m1.webp', 'CAM 01'], ['m2.webp', 'CAM 02'], ['m3.jpg', 'CAM 03'], ['m4.webp', 'CAM 04'], ['m5.jpg', 'CAM 05'], ['m6.jpg', 'CAM 06 · DETECCIÓN']]
          .map(([f, t], i) => `<div class="tesela t${i + 1}" style="background-image:url('img/mosaico/${f}')"><span class="tesela-tag"><i></i>${t}</span></div>`).join('')}
      </div>
      <div class="portada-marca">
        <span class="esq e1"></span><span class="esq e2"></span><span class="esq e3"></span><span class="esq e4"></span>
        <img src="img/logo-portada.png" alt="TeleArseg">
        <div class="portada-lema">${['CCTV', 'GPS', 'INTERNET', 'SOPORTE TÉCNICO', 'TORRES', 'PANELES SOLARES'].map((s) => `<span>${s}</span>`).join('<b>·</b>')}</div>
      </div>
      <div class="portada-texto">
      <span class="en-vivo"><i></i> Centro de monitoreo 24/7</span>
      <h1>Portal de <span class="grad">MONITOREO</span></h1>
      <p>${esc(P().nombre)} · datos importados el ${esc(S.datos.generado)}</p></div></div>
    <div class="tarjetas">
      ${tarjeta('Propiedades CCTV', entero(props.length), `${grupos.length - 1} grupos y clientes directos`, 'propiedad')}
      ${tarjeta('Cámaras', entero(t.total), `${entero(t.fijas)} fijas · ${entero(t.ptz)} PTZ`, 'camara',
        `<div class="mini-barra"><span class="fija" style="width:${t.total ? (t.fijas / t.total) * 100 : 0}%"></span><span class="ptz" style="width:${t.total ? (t.ptz / t.total) * 100 : 0}%"></span></div>`)}
      ${tarjeta('Cámaras activas', entero(t.activas), `${entero(t.pasivas)} pasivas · ${entero(t.total - t.activas - t.pasivas)} sin contrato o sin monitoreo`, 'activa',
        `<div class="mini-barra"><span class="act" style="width:${t.total ? (t.activas / t.total) * 100 : 0}%"></span><span class="pas" style="width:${t.total ? (t.pasivas / t.total) * 100 : 0}%"></span></div>`)}
      ${v ? tarjeta('Valor CCTV', dinero(t.valor), 'según los consolidados', 'dinero') : ''}
      ${tarjeta('GPS', entero(S.datos.gps.length) + ' clientes', `${entero(S.datos.gps.reduce((s, g) => s + unidadesDe(g.vehiculos || []), 0))} unidades${v ? ' · ' + dinero(valGps) : ''}`, 'gps')}
      ${tarjeta('COSTANET', entero(S.datos.costanet.length) + ' nodos', `${entero(camCostanet)} cámaras`, 'red')}
    </div>
    ${panelEstaciones(props)}
    <div class="panel">
      ${titulo('grupo', 'Por grupo', 'Toca un grupo para ver sus propiedades. Incluye los clientes GPS: en ellos se cuentan unidades en lugar de cámaras.')}
      <div class="tabla-scroll"><table>
        <thead><tr><th>Grupo</th><th class="n">Propiedades</th><th class="n">Cámaras</th><th class="n">Fijas</th><th class="n">PTZ</th><th class="n">Activas</th>${v ? '<th class="n">Valor</th>' : ''}</tr></thead>
        <tbody>${grupos.map(([g, ps]) => {
          const s = sumar(ps);
          return `<tr class="clic" data-ir="#/cctv?grupo=${encodeURIComponent(g)}"><td>${esc(g)}</td><td class="n">${ps.length}</td><td class="n">${s.total}</td><td class="n">${s.fijas}</td><td class="n">${s.ptz}</td><td class="n">${s.activas}</td>${v ? `<td class="n">${dinero(s.valor)}</td>` : ''}</tr>`;
        }).join('')}
        ${gpsN ? `<tr class="clic fila-gps" data-ir="#/gps"><td>GPS</td><td class="n">${gpsN} <small class="vacio">clientes</small></td><td class="n">${gpsUni} <small class="vacio">unidades</small></td><td class="n">—</td><td class="n">—</td><td class="n">${gpsAct}</td>${v ? `<td class="n">${dinero(valGps)}</td>` : ''}</tr>` : ''}</tbody>
        <tfoot><tr><td>Total</td><td class="n">${props.length + gpsN}</td><td class="n">${t.total + gpsUni}</td><td class="n">${t.fijas}</td><td class="n">${t.ptz}</td><td class="n">${t.activas + gpsAct}</td>${v ? `<td class="n">${dinero(t.valor + valGps)}</td>` : ''}</tr></tfoot>
      </table></div>
    </div>
    ${P().editar ? panelCruceIp() : ''}
    ${P().editar && S.datos.avisos.length ? `<div class="panel"><h2>Pendientes por completar (${S.datos.avisos.length})</h2><ul class="pendientes">${S.datos.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
  `;
  c.querySelectorAll('[data-ir]').forEach((tr) => (tr.onclick = () => (location.hash = tr.dataset.ir)));
  c.querySelectorAll('[data-estacion]').forEach((tr) => (tr.onclick = () => {
    const det = c.querySelector(`[data-detalle="${tr.dataset.estacion}"]`);
    det.hidden = !det.hidden;
    tr.classList.toggle('abierta', !det.hidden);
  }));
}

// Estaciones: orden natural (ESTACIÓN 2 antes que ESTACIÓN 10)
const ordenNatural = (a, b) => a.localeCompare(b, 'es', { numeric: true });
function listaEstaciones() {
  const s = new Set(S.datos.propiedades.map((p) => p.estacion).filter(Boolean));
  return [...s].sort(ordenNatural);
}

// Dashboard de carga por estación: solo propiedades en monitoreo y cámaras en estado ACTIVO
function panelEstaciones(props) {
  const enMon = props;
  const sinMon = (p) => p.monitoreo === 'SIN MONITOREO';
  const activas = (p) => sinMon(p) ? [] : (p.camaras || []).filter((c) => c.estado === 'ACTIVO');
  const m = new Map();
  for (const p of props) {
    const e = p.estacion || 'SIN ESTACIÓN';
    if (!m.has(e)) m.set(e, []);
    m.get(e).push(p);
  }
  if (!m.size) return '';
  const filas = [...m.entries()].sort((a, b) => (a[0] === 'SIN ESTACIÓN') - (b[0] === 'SIN ESTACIÓN') || ordenNatural(a[0], b[0])).map(([e, ps]) => {
    const cams = ps.flatMap(activas);
    return { e, ps, n: ps.length, total: cams.length, fijas: cams.filter((c) => c.tipo !== 'PTZ').length, ptz: cams.filter((c) => c.tipo === 'PTZ').length };
  });
  // Estación GPS: los clientes GPS y sus unidades en monitoreo (ACTIVO u OPERATIVA)
  const gpsCli = (S.datos.gps || []).map((g) => ({ g, n: unidadesDe((g.vehiculos || []).filter((x) => ACTIVOS.includes(x.estado))) }));
  if (gpsCli.length) filas.push({ e: 'ESTACIÓN GPS', gps: true, ps: gpsCli, n: gpsCli.length, total: gpsCli.reduce((s, x) => s + x.n, 0), fijas: 0, ptz: 0 });
  const total = filas.reduce((s, f) => s + f.total, 0);
  const max = Math.max(...filas.map((f) => f.total), 1);
  const reales = filas.filter((f) => f.e !== 'SIN ESTACIÓN');
  const promedio = reales.length ? total / reales.length : 0;
  const clave = (e) => e.replace(/[^A-Za-z0-9]/g, '');
  return `<div class="panel">
    ${titulo('estacion', 'Carga por estación', `Se cuentan todas las propiedades y clientes GPS; en monitoreo solo las cámaras en estado ACTIVO y las unidades GPS activas u operativas. Promedio por estación: <strong>${promedio.toFixed(0)}</strong>. Toca una estación para ver su detalle.`)}
    <div class="tabla-scroll"><table class="tabla-estaciones">
      <thead><tr><th>Estación</th><th class="n">Propiedades / clientes</th><th class="n">En monitoreo</th><th class="n">Fijas</th><th class="n">PTZ</th><th class="n">% de la carga</th><th class="barra-col">Carga</th></tr></thead>
      <tbody>${filas.map((f) => {
        const pct = total ? (f.total / total) * 100 : 0;
        const nivel = f.total > promedio * 1.25 ? 'alta' : f.total < promedio * 0.75 ? 'baja' : 'media';
        const detalle = f.gps
          ? f.ps.slice().sort((a, b) => b.n - a.n).map(({ g, n }) => `<a href="#/gps"><span>${esc(g.cliente)}</span><span class="chip">${n} unid.</span></a>`).join('')
          : f.ps.map((p) => ({ p, n: activas(p).length })).sort((a, b) => b.n - a.n).map(({ p, n }) => `<a href="#/cctv/${p.id}"><span>${esc(p.nombre)}${sinMon(p) ? ' <small class="vacio">(sin monitoreo)</small>' : ''}</span><span class="chip">${n}</span></a>`).join('');
        return `<tr class="clic ${f.gps ? 'fila-gps' : ''}" data-estacion="${clave(f.e)}"><td><span class="flecha">▸</span> <span class="num-est">${f.gps ? icono('gps') : esc((f.e.match(/\d+/) || ['–'])[0])}</span> <strong>${esc(f.e)}</strong></td>
          <td class="n">${f.n}${f.gps ? ' <small class="vacio">clientes</small>' : ''}</td><td class="n"><strong>${f.total}</strong>${f.gps ? ' <small class="vacio">unidades</small>' : ''}</td>
          <td class="n">${f.gps ? '—' : f.fijas}</td><td class="n">${f.gps ? '—' : f.ptz}</td><td class="n">${pct.toFixed(1)}%</td>
          <td class="barra-col"><div class="barra-carga"><div class="barra-relleno ${nivel}" style="width:${(f.total / max) * 100}%"></div></div></td></tr>
          <tr class="detalle-estacion" data-detalle="${clave(f.e)}" hidden><td colspan="7"><div class="props-estacion">${detalle}</div></td></tr>`;
      }).join('')}</tbody>
      <tfoot><tr><td>Total</td><td class="n">${filas.reduce((s, f) => s + f.n, 0)}</td><td class="n">${total}</td><td class="n">${filas.reduce((s, f) => s + f.fijas, 0)}</td><td class="n">${filas.reduce((s, f) => s + f.ptz, 0)}</td><td class="n">100%</td><td></td></tr></tfoot>
    </table></div>
    <p class="leyenda"><span class="punto alta"></span> más de 25% sobre el promedio <span class="punto media"></span> normal <span class="punto baja"></span> más de 25% bajo el promedio</p>
  </div>`;
}

function panelCruceIp() {
  const cruce = S.datos.cruceIp || [];
  if (!cruce.length) return '';
  const cams = S.datos.propiedades.flatMap((p) => p.camaras || []);
  const conIp = cams.filter((c) => c.ip).length;
  const porConf = cams.filter((c) => c.ipPorConfirmar).length;
  const fuera = cruce.filter((c) => !c.propiedadPortal);
  const conSobrantes = cruce.filter((c) => c.propiedadPortal && c.sinPareja && c.sinPareja.length);
  const propDe = (nombre) => S.datos.propiedades.find((p) => p.nombre === String(nombre).split('|')[0]);
  return `<div class="panel">
    <h2>IP traídas del Panel Central CCTV</h2>
    <div class="tarjetas">
      ${tarjeta('Cámaras con IP', entero(conIp), `de ${entero(cams.length)} cámaras`)}
      ${tarjeta('IP por confirmar', entero(porConf), 'el nombre no coincidía exacto')}
      ${tarjeta('Cámaras del panel sin pareja', entero(cruce.reduce((s, c) => s + (c.sinPareja || []).length, 0)), 'están en el panel pero no aquí')}
    </div>
    <p class="vacio">Las IP marcadas "por confirmar" se revisan en la ficha de cada propiedad: al guardar la cámara con "Editar", quedan confirmadas.</p>
    <details><summary>Ver propiedades con cámaras sin pareja (${conSobrantes.length + fuera.length})</summary>
      <div class="tabla-scroll"><table><thead><tr><th>En el panel</th><th>En el portal</th><th class="n">Emparejadas</th><th>Cámaras del panel sin pareja</th></tr></thead><tbody>
      ${conSobrantes.map((c) => { const p = propDe(c.propiedadPortal); return `<tr${p ? ` class="clic" data-ir="#/cctv/${p.id}"` : ''}><td>${esc(c.propiedadPanel)}</td><td>${esc(String(c.propiedadPortal).replace(/\|/g, ', '))}</td><td class="n">${c.emparejadas} / ${c.camarasPanel}</td><td>${esc(c.sinPareja.join(' · '))}</td></tr>`; }).join('')}
      ${fuera.map((c) => `<tr><td>${esc(c.propiedadPanel)}</td><td><span class="chip e-sin-monitoreo">no está en el portal</span></td><td class="n">0 / ${c.camarasPanel}</td><td>${esc((c.sinPareja || []).join(' · '))}</td></tr>`).join('')}
      </tbody></table></div>
    </details>
  </div>`;
}
// Iconos (trazos simples, heredan el color del texto)
const ICONOS = {
  propiedad: '<path d="M3 21h18M5 21V8l7-5 7 5v13M9 21v-6h6v6"/>',
  camara: '<path d="M3 7h12l3 3v4l-3 3H3zM18 10l3-2v8l-3-2"/><circle cx="9" cy="12" r="2.5"/>',
  activa: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  gps: '<path d="M12 22s7-6.2 7-12a7 7 0 1 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>',
  red: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/><path d="M12 7.5v4M12 11.5l-5.5 5.5M12 11.5l5.5 5.5"/>',
  dinero: '<path d="M12 2v20M17 6.5c-1-1.5-3-2.5-5-2.5-2.8 0-5 1.5-5 3.8 0 5.2 10 2.6 10 8 0 2.3-2.2 3.7-5 3.7-2.3 0-4.3-1-5.3-2.7"/>',
  estacion: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  grupo: '<circle cx="8" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M2 20c0-3.3 2.7-6 6-6s6 2.7 6 6M14 20c0-2.5 1.5-4.5 4-4.5s4 2 4 4.5"/>',
  alerta: '<path d="M12 3 2 20h20zM12 10v4M12 17h.01"/>',
};
const icono = (n) => `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONOS[n] || ''}</svg>`;
const tarjeta = (etq, num, det, ico, extra = '') => `<div class="tarjeta"><div class="tarjeta-cab">${ico ? `<span class="tarjeta-ico">${icono(ico)}</span>` : ''}<div class="etq">${esc(etq)}</div></div><div class="num">${num}</div><div class="det">${esc(det)}</div>${extra}</div>`;
const titulo = (ico, txt, sub = '') => `<div class="panel-titulo"><span class="panel-ico">${icono(ico)}</span><div><h2>${txt}</h2>${sub ? `<p>${sub}</p>` : ''}</div></div>`;

// ---------------- CCTV ----------------
function vCctv(c, args) {
  const params = S.params;
  const idSel = args[0] && args[0].startsWith('p') ? args[0] : null;
  const grupos = porGrupo(S.datos.propiedades);
  const propSel = idSel && buscarProp(idSel);
  document.body.classList.toggle('cctv-sel', !!propSel);
  c.innerHTML = `
    <div class="dos-col ${propSel ? 'con-detalle' : ''}">
      <div class="panel">
        <div class="filtros"><input type="search" id="q" placeholder="Buscar propiedad o cámara…"></div>
        <div class="filtros"><select id="fg"><option value="">Todos los grupos</option>${grupos.map(([g]) => `<option>${esc(g)}</option>`).join('')}</select></div>
        <div class="acciones abrir-cerrar"><button type="button" class="btn mini" id="abrir-todos">Abrir todos</button><button type="button" class="btn mini" id="cerrar-todos">Cerrar todos</button></div>
        <div class="lista" id="lista"></div>
      </div>
      <div id="detalle"></div>
    </div>`;
  const q = $('#q'), fg = $('#fg');
  q.value = sessionStorage.getItem('portal.q') || '';
  fg.value = params.get('grupo') || sessionStorage.getItem('portal.fg') || '';
  if (propSel && fg.value && fg.value !== grupoDe(propSel)) fg.value = '';
  // Grupos abiertos/cerrados (se recuerda en esta computadora)
  let abiertos;
  try { abiertos = new Set(JSON.parse(localStorage.getItem('portal.abiertos') || '[]')); } catch (e) { abiertos = new Set(); }
  if (propSel) abiertos.add(grupoDe(propSel));
  const guardarAbiertos = () => localStorage.setItem('portal.abiertos', JSON.stringify([...abiertos]));
  guardarAbiertos();
  const pintarLista = () => {
    sessionStorage.setItem('portal.q', q.value);
    sessionStorage.setItem('portal.fg', fg.value);
    const t = normal(q.value.trim());
    let html = '';
    for (const [g, ps] of grupos) {
      if (fg.value && fg.value !== g) continue;
      const vis = ps.filter((p) => !t || normal(p.nombre).includes(t) || (p.camaras || []).some((x) => normal(x.nombre).includes(t) || normal(x.codigo).includes(t)));
      if (!vis.length) continue;
      const abierto = abiertos.has(g);
      const cams = vis.reduce((s, p) => s + (p.camaras || []).length, 0);
      html += `<button type="button" class="grupo ${abierto ? 'abierto' : ''}" data-grupo="${esc(g)}" aria-expanded="${abierto}">
        <span class="flecha">${abierto ? '▾' : '▸'}</span><span class="g-nombre">${esc(g)}</span>
        <span class="g-info">${vis.length} prop. · ${cams} cám.</span></button>`;
      if (abierto) html += vis.map((p) => `<a href="#/cctv/${p.id}" class="${p.id === idSel ? 'sel' : ''}"><span>${esc(p.nombre)}</span>${p.monitoreo === 'SIN MONITOREO' ? '<span class="chip e-sin-monitoreo">sin monitoreo</span>' : `<span class="chip">${(p.camaras || []).length}</span>`}</a>`).join('');
    }
    $('#lista').innerHTML = html || '<p class="vacio" style="padding:0 16px">Sin resultados</p>';
    $('#lista').querySelectorAll('button.grupo').forEach((b) => (b.onclick = () => {
      const g = b.dataset.grupo;
      if (abiertos.has(g)) abiertos.delete(g); else abiertos.add(g);
      guardarAbiertos();
      pintarLista();
    }));
  };
  const todos = (abrir) => { abiertos = new Set(abrir ? grupos.map(([g]) => g) : []); guardarAbiertos(); pintarLista(); };
  $('#abrir-todos').onclick = () => todos(true);
  $('#cerrar-todos').onclick = () => todos(false);
  // Al buscar o filtrar se abren los grupos con resultados, pero luego se pueden cerrar con la flecha
  q.oninput = () => {
    const t = normal(q.value.trim());
    if (t) for (const [g, ps] of grupos) {
      if (ps.some((p) => normal(p.nombre).includes(t) || (p.camaras || []).some((x) => normal(x.nombre).includes(t) || normal(x.codigo).includes(t)))) abiertos.add(g);
    }
    guardarAbiertos();
    pintarLista();
  };
  fg.onchange = () => {
    if (fg.value) abiertos.add(fg.value);
    guardarAbiertos();
    pintarLista();
  };
  pintarLista();
  const sel = $('#lista a.sel');
  if (sel) sel.scrollIntoView({ block: 'center' });
  const prop = propSel;
  if (prop) {
    detalleProp($('#detalle'), prop);
    $('#detalle').insertAdjacentHTML('afterbegin', '<a class="btn volver" href="#/cctv">← Volver a la lista</a>');
  }
  else $('#detalle').innerHTML = '<div class="panel bienvenida-cctv"><p>Elige una propiedad de la lista para ver sus cámaras.</p></div>';
}

// Columnas de la tabla de cámaras que el administrador puede editar con doble clic
const EDITABLE_DIRECTO = ['codigo', 'nombre', 'modelo', 'ubicacion', 'sector', 'proveedor', 'ip', 'puerto', 'ipNvr', 'ipLocal', 'marca'];

function detalleProp(c, p) {
  const v = P().valores, ed = P().editar;
  const s = stats(p);
  const cams = p.camaras || [];
  const hay = (k) => cams.some((x) => x[k]);
  const cols = [
    ['foto', 'Foto', cams.some((x) => (x.fotos || []).length) || ed],
    ['codigo', 'Código', hay('codigo')], ['nombre', 'Nombre', true], ['tipo', 'Tipo', true], ['modelo', 'Modelo', hay('modelo')],
    ['estado', 'Estado', true], ['ubicacion', 'Ubicación', true], ['sector', 'Sector', hay('sector')], ['servicio', 'Servicio', hay('servicio')], ['proveedor', 'Proveedor', hay('proveedor')],
    ['ip', 'IP', hay('ip')], ['puerto', 'Puerto', hay('puerto')], ['ipNvr', 'IP grabador', hay('ipNvr')], ['ipLocal', 'IP local', hay('ipLocal')],
    ['marca', 'Marca', hay('marca')], ['fechaIngreso', 'Ingreso', hay('fechaIngreso')],
    ['valor', 'Valor', v], ['comentario', 'Comentario', v && hay('comentario')],
  ].filter((x) => x[2]);
  const celda = (cam, k, idx) => {
    if (k === 'foto') {
      const f = (cam.fotos || [])[0];
      if (!f) return '<span class="sin-foto">Sin foto</span>';
      return `<button class="mini-cam" data-galeria="${idx}" title="Ver foto"><img src="${urlFoto(f.mini)}" alt="" loading="lazy">${cam.fotos.length > 1 ? `<span class="mini-n">${cam.fotos.length}</span>` : ''}</button>`;
    }
    if (k === 'estado') return chipEstado(cam.estado);
    if (k === 'ubicacion') {
      const u = String(cam.ubicacion || '').trim();
      if (!u) return '<span class="vacio">Pendiente</span>';
      const enlace = /^https?:\/\//i.test(u) ? u : `https://www.google.com/maps?q=${encodeURIComponent(u)}`;
      return `<a class="btn mini prim mapa-cam" href="${esc(enlace)}" target="_blank" rel="noopener">Abrir en Google Maps</a>${/^https?:/i.test(u) ? '' : `<div class="coord mini-coord">${esc(u)}</div>`}`;
    }
    if (k === 'valor') return cam.valor ? dinero(cam.valor) : '';
    if (k === 'fechaIngreso') return fecha(cam.fechaIngreso);
    if (k === 'ip' && cam.ip) return `<span class="coord">${esc(cam.ip)}</span>${cam.ipPorConfirmar ? ` <span class="chip e-por-ingresar" title="En el panel se llama: ${esc(cam.nombreEnPanel)}">por confirmar</span>` : ''}`;
    if ((k === 'ipNvr' || k === 'ipLocal') && cam[k]) return `<span class="coord">${esc(cam[k])}</span>`;
    return esc(cam[k]);
  };
  const ct = p.contacto || {};
  c.innerHTML = `
    <div class="panel">
      <div class="encabezado">
        <div>${p.grupo ? `<span class="chip grupo">${esc(p.grupo)}</span>` : ''}${p.monitoreo === 'SIN MONITOREO' ? ' <span class="chip e-sin-monitoreo">SIN MONITOREO</span>' : ''}<h1>${esc(p.nombre)}</h1>${p.nombreEnCoordenadas && !normal(p.nombreEnCoordenadas).includes(normal(p.nombre)) ? `<p>También registrada como: ${esc(p.nombreEnCoordenadas)}</p>` : ''}</div>
        ${p.monitoreo === 'SIN MONITOREO' && !p.equipos ? '' : `<div class="equipos ${p.equipos === 'RENTING' ? 'renting' : p.equipos ? 'cliente' : 'pend'}"><small>Equipos</small><strong>${p.equipos ? esc(p.equipos) : 'Por definir'}</strong></div>`}
        <div class="equipos estacion ${p.estacion ? '' : 'pend'}"><small>Estación</small><strong>${p.estacion ? esc(p.estacion) : 'Por asignar'}</strong></div>
        ${ed ? '<div class="acciones"><button class="btn" id="ed-prop">Editar propiedad</button><button class="btn prim" id="nueva-cam">Agregar cámara</button></div>' : ''}
      </div>
      <div class="tarjetas">
        ${tarjeta('Cámaras', s.total, `${s.fijas} fijas · ${s.ptz} PTZ`, 'camara')}
        ${tarjeta('Activas', s.activas, `${s.pasivas} pasivas`, 'activa')}
        ${v ? tarjeta('Valor', dinero(s.valor), 'cámaras y otros servicios', 'dinero') : ''}
      </div>
    </div>
    <div class="panel">
      <h2>Ubicación</h2>
      ${p.lat == null && !p.mapa && p.monitoreo !== 'SIN MONITOREO' ? '<p class="aviso-pendiente">Ubicación pendiente: esta propiedad no tiene coordenadas registradas.</p>' : ''}
      <div class="datos">
        <div><small>Sector</small>${esc(p.ubicacion) || '<span class="vacio">Sin dato</span>'}</div>
        <div><small>Coordenadas</small>${p.lat != null ? `<span class="coord">${p.lat}, ${p.lng}</span> <button class="btn mini" id="copiar-coord">Copiar</button>` : '<span class="vacio">Pendiente</span>'}</div>
        <div><small>Google Maps</small>${p.lat != null || p.mapa ? `<a class="btn mini prim" href="${esc(p.mapa || `https://www.google.com/maps?q=${p.lat},${p.lng}`)}" target="_blank" rel="noopener">Abrir en Google Maps</a>` : '<span class="vacio">Pendiente</span>'}</div>
      </div>
      <div class="como-llegar"><small>Cómo llegar</small>${esc(p.referencia) || '<span class="vacio">Sin referencia registrada</span>'}</div>
    </div>
    <div class="panel">
      <h2>Contacto</h2>
      <div class="datos">
        <div><small>Razón social</small>${esc(p.razonSocial) || '<span class="vacio">Sin dato</span>'}</div>
        <div><small>Cliente</small>${esc(ct.cliente) || '<span class="vacio">Sin dato</span>'}</div>
        <div><small>Responsable</small>${esc(ct.responsable) || '<span class="vacio">Sin dato</span>'}</div>
        <div><small>Jefe de seguridad o encargado</small>${esc(ct.nombre) || '<span class="vacio">Sin dato</span>'}${ct.cargo ? ` <span class="chip">${esc(ct.cargo)}</span>` : ''}</div>
        <div><small>Teléfono</small>${ct.telefono ? `<a href="tel:${esc(ct.telefono)}">${esc(ct.telefono)}</a>` : '<span class="vacio">Sin dato</span>'}</div>
      </div>
    </div>
    <div class="panel">
      <h2>Cámaras (${cams.length})</h2>
      ${cams.length ? `<div class="tabla-scroll"><table>
        <thead><tr><th>#</th>${cols.map(([k, t]) => `<th class="${k === 'valor' ? 'n' : ''}">${t}</th>`).join('')}${ed ? '<th></th>' : ''}</tr></thead>
        <tbody>${cams.map((cam, i) => `<tr><td>${i + 1}</td>${cols.map(([k]) => `<td class="${k === 'valor' ? 'n' : ''}${ed && EDITABLE_DIRECTO.includes(k) ? ' editable' : ''}"${ed && EDITABLE_DIRECTO.includes(k) ? ` data-ed-cam="${i}" data-ed-k="${k}" title="Doble clic para editar"` : ''}>${celda(cam, k, i)}</td>`).join('')}${ed ? `<td><button class="btn mini" data-cam="${i}">Editar</button></td>` : ''}</tr>`).join('')}</tbody>
      </table></div>` : '<p class="vacio">Esta propiedad no tiene cámaras registradas.</p>'}
      ${(p.servicios || []).length ? `<h3>Otros servicios</h3><table>
        <thead><tr><th>Servicio</th><th>Estado</th>${v ? '<th class="n">Valor</th>' : ''}</tr></thead>
        <tbody>${p.servicios.map((x) => `<tr><td>${esc(x.nombre)}</td><td>${chipEstado(x.estado)}</td>${v ? `<td class="n">${x.valor ? dinero(x.valor) : ''}</td>` : ''}</tr>`).join('')}</tbody>
      </table>` : ''}
      ${v && cams.some((x) => x.valor) && cams.some((x) => !x.valor && ACTIVOS.includes(x.estado)) ? '<p class="vacio">Algunas cámaras no tienen valor propio porque su precio está incluido en un paquete con la cámara de arriba, igual que en el Excel.</p>' : ''}
    </div>`;
  c.querySelectorAll('[data-galeria]').forEach((b) => (b.onclick = () => galeria(cams[Number(b.dataset.galeria)])));
  const cp = $('#copiar-coord');
  if (cp) cp.onclick = async () => {
    try { await navigator.clipboard.writeText(`${p.lat}, ${p.lng}`); toast('Coordenadas copiadas'); }
    catch (e) { toast(`${p.lat}, ${p.lng}`); }
  };
  if (!ed) return;
  $('#ed-prop').onclick = () => editarProp(p);
  $('#nueva-cam').onclick = () => editarCamara(p, -1);
  c.querySelectorAll('[data-cam]').forEach((b) => (b.onclick = () => editarCamara(p, Number(b.dataset.cam))));
  // Doble clic en una celda: se edita ahí mismo (Enter guarda, Esc cancela)
  c.querySelectorAll('[data-ed-cam]').forEach((td) => (td.ondblclick = (e) => {
    if (td.querySelector('input')) return;
    e.preventDefault();
    const cam = cams[Number(td.dataset.edCam)], k = td.dataset.edK;
    const antes = td.innerHTML;
    td.innerHTML = `<div class="razon-editar"><input class="razon-input" type="text" value="${esc(cam[k] ?? '')}" placeholder="${k === 'ubicacion' ? 'Coordenadas o enlace de Google Maps' : ''}">
      <button class="lapiz ok" title="Guardar (Enter)">✓</button><button class="lapiz no" title="Cancelar (Esc)">✕</button></div>`;
    const inp = td.querySelector('input');
    inp.focus(); inp.select();
    let listo = false;
    const cancelar = () => { if (listo) return; listo = true; td.innerHTML = antes; };
    const ok = async () => {
      if (listo) return; listo = true;
      const val = inp.value.trim() || null;
      if (val === (cam[k] ?? null)) { td.innerHTML = antes; return; }
      cam[k] = val;
      if (k === 'ip') cam.ipPorConfirmar = false;
      await guardar(`cámara editada (${k}): ${cam.nombre || ''} en ${p.nombre}`);
      mostrar();
    };
    inp.onkeydown = (ev) => { if (ev.key === 'Enter') ok(); else if (ev.key === 'Escape') cancelar(); };
    td.querySelector('.ok').onmousedown = (ev) => { ev.preventDefault(); ok(); };
    td.querySelector('.no').onmousedown = (ev) => { ev.preventDefault(); cancelar(); };
    inp.onblur = () => setTimeout(cancelar, 150);
  }));
}

// ---------------- Edición (solo administrador) ----------------
function formulario(titulo, campos, valores, alGuardar, alBorrar, extra) {
  const m = $('#modal');
  m.innerHTML = `<div class="caja"><h2>${esc(titulo)}</h2>${extra ? extra.html : ''}<form class="form" id="f">
    ${campos.map((f) => `<div class="${f.ancho ? 'ancho' : ''}"><label for="c-${f.k}">${esc(f.t)}</label>${
      f.op ? `<select id="c-${f.k}">${['', ...f.op].map((o) => `<option ${String(valores[f.k] ?? '') === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
      : f.area ? `<textarea id="c-${f.k}" rows="3">${esc(valores[f.k])}</textarea>`
      : `<input id="c-${f.k}" type="${f.num ? 'number' : 'text'}" step="any" value="${esc(valores[f.k])}">`}</div>`).join('')}
    </form><div class="acciones" style="justify-content:space-between">
      <div>${alBorrar ? '<button class="btn peligro" id="borrar">Eliminar</button>' : ''}</div>
      <div class="acciones"><button class="btn" id="cancelar">Cancelar</button><button class="btn prim" id="ok">Guardar</button></div>
    </div></div>`;
  m.hidden = false;
  const cerrar = () => { m.hidden = true; m.innerHTML = ''; };
  $('#cancelar').onclick = cerrar;
  m.onclick = (e) => { if (e.target === m) cerrar(); };
  $('#ok').onclick = () => {
    const out = {};
    for (const f of campos) {
      const raw = $('#c-' + f.k).value.trim();
      out[f.k] = f.num ? (raw === '' ? null : Number(raw)) : (raw || null);
    }
    cerrar();
    alGuardar(out);
  };
  if (alBorrar) $('#borrar').onclick = () => { if (confirm('¿Eliminar este registro?')) { cerrar(); alBorrar(); } };
  if (extra && extra.init) extra.init();
}

// Sección de fotos dentro de "Editar cámara": los cambios de fotos se guardan al momento
function seccionFotos(p, cam) {
  const html = `<div class="fotos-edicion"><h3>Fotos</h3><div id="fe-lista"></div>
    ${S.servidor ? `<div class="fe-subir">
        <div class="zona-pegar" id="fe-pegar" tabindex="0"><strong>📋 Pegar imagen</strong><span>Copia la imagen y presiona <kbd>Ctrl</kbd> + <kbd>V</kbd> (o arrástrala aquí)</span></div>
        <label class="btn prim subir-foto">📁 Elegir archivo<input type="file" id="fe-archivo" accept="image/*" multiple hidden></label>
      </div>
      <span id="fe-estado" class="vacio"></span>
      <p class="vacio">Los cambios de fotos se guardan al instante. La primera foto es la que se ve en la tabla.</p>`
    : '<p class="vacio">Para subir o borrar fotos, abre la página con el servidor del proyecto (herramientas\\servidor.ps1).</p>'}</div>`;
  const init = () => {
    const pintar = () => {
      const fotos = cam.fotos || [];
      $('#fe-lista').innerHTML = fotos.length ? `<div class="fe-grid">${fotos.map((f, j) => `<div class="fe-item">
          <img src="${urlFoto(f.mini)}" alt="" data-ver="${j}">
          <div class="fe-acc">${j === 0 ? '<span class="chip e-activo">principal</span>' : `<button type="button" class="btn mini" data-principal="${j}">Principal</button>`}
          ${S.servidor ? `<button type="button" class="btn mini peligro" data-quitar="${j}">Eliminar</button>` : ''}</div>
        </div>`).join('')}</div>` : '<p class="vacio">Esta cámara no tiene fotos.</p>';
      $('#fe-lista').querySelectorAll('[data-ver]').forEach((im) => (im.onclick = () => window.open(urlFoto(cam.fotos[Number(im.dataset.ver)].web), '_blank')));
      $('#fe-lista').querySelectorAll('[data-principal]').forEach((b) => (b.onclick = async () => {
        const j = Number(b.dataset.principal);
        cam.fotos.unshift(cam.fotos.splice(j, 1)[0]);
        await guardar(`foto principal cambiada en ${cam.nombre} (${p.nombre})`);
        pintar();
      }));
      $('#fe-lista').querySelectorAll('[data-quitar]').forEach((b) => (b.onclick = async () => {
        const j = Number(b.dataset.quitar);
        const [f] = cam.fotos.splice(j, 1);
        await borrarFoto(f);
        await guardar(`foto eliminada de ${cam.nombre} (${p.nombre})`);
        pintar();
      }));
    };
    pintar();
    const subir = async (archivos) => {
      archivos = archivos.filter((a) => a && a.type.startsWith('image/'));
      if (!archivos.length) { toast('Lo copiado no es una imagen'); return; }
      const est = $('#fe-estado');
      let ok = 0;
      for (const [n, a] of archivos.entries()) {
        est.textContent = `Subiendo ${n + 1} de ${archivos.length}…`;
        // Las imágenes pegadas llegan sin nombre real: se usa la extensión según su tipo
        const archivo = /\.[a-z0-9]+$/i.test(a.name || '') && a.name !== 'image.png' ? a
          : new File([a], 'pegada.' + ({ 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp' }[a.type] || 'png'), { type: a.type });
        try { (cam.fotos = cam.fotos || []).push(await subirFoto(cam, archivo)); ok++; pintar(); }
        catch (e) { toast(`No se pudo subir la imagen: ${e.message}`); }
      }
      est.textContent = '';
      if (ok) await guardar(`${ok} foto(s) agregada(s) a ${cam.nombre} (${p.nombre})`);
    };
    const inp = $('#fe-archivo');
    if (!inp) return;
    inp.onchange = async () => { await subir([...inp.files]); inp.value = ''; };
    // Pegar con Ctrl+V en cualquier parte del formulario (salvo dentro de un campo de texto con texto copiado)
    // Solo un "pegar" activo a la vez: el de la cámara cuyo formulario está abierto ahora
    if (window.pegarFotoActivo) document.removeEventListener('paste', window.pegarFotoActivo);
    const zonaActual = $('#fe-pegar');
    const alPegar = (e) => {
      if (!zonaActual.isConnected) { document.removeEventListener('paste', alPegar); window.pegarFotoActivo = null; return; }
      const imgs = [...(e.clipboardData?.items || [])].filter((it) => it.kind === 'file' && it.type.startsWith('image/')).map((it) => it.getAsFile());
      if (!imgs.length) return; // texto normal: se pega en el campo como siempre
      e.preventDefault();
      subir(imgs);
    };
    document.addEventListener('paste', alPegar);
    window.pegarFotoActivo = alPegar;
    const zona = zonaActual;
    zona.onclick = () => { zona.focus(); toast('Ahora presiona Ctrl + V para pegar la imagen'); };
    zona.ondragover = (e) => { e.preventDefault(); zona.classList.add('encima'); };
    zona.ondragleave = () => zona.classList.remove('encima');
    zona.ondrop = (e) => { e.preventDefault(); zona.classList.remove('encima'); subir([...e.dataTransfer.files]); };
  };
  return { html, init };
}

function editarCamara(p, i) {
  const nueva = i < 0;
  const cam = nueva ? { estado: 'ACTIVO', tipo: 'FIJA' } : p.camaras[i];
  formulario(nueva ? `Nueva cámara · ${p.nombre}` : `Editar cámara · ${p.nombre}`, [
    { k: 'codigo', t: 'Código' }, { k: 'nombre', t: 'Nombre' },
    { k: 'tipo', t: 'Tipo', op: ['FIJA', 'PTZ'] }, { k: 'modelo', t: 'Modelo' },
    { k: 'estado', t: 'Estado', op: ESTADOS_CAMARA }, { k: 'valor', t: 'Valor', num: true },
    { k: 'ubicacion', t: 'Ubicación de la cámara (coordenadas o enlace de Google Maps)', ancho: true },
    { k: 'sector', t: 'Sector' }, { k: 'servicio', t: 'Servicio', op: ['RENTING', 'PROPIEDAD DEL CLIENTE'] },
    { k: 'proveedor', t: 'Proveedor' }, { k: 'fechaIngreso', t: 'Fecha de ingreso (AAAA-MM-DD)' },
    { k: 'ip', t: 'IP' }, { k: 'puerto', t: 'Puerto' }, { k: 'ipNvr', t: 'IP del grabador (NVR)' }, { k: 'marca', t: 'Marca' },
    { k: 'comentario', t: 'Comentario', area: true, ancho: true },
  ], cam, async (val) => {
    val.ipPorConfirmar = false; // al guardar, el administrador da la IP por revisada
    if (nueva) {
      val.id = `${p.id}-n${Date.now()}`;
      val.fotos = [];
      p.camaras.push(val);
    } else Object.assign(p.camaras[i], val);
    await guardar(`${nueva ? 'cámara agregada' : 'cámara editada'}: ${val.nombre || ''} en ${p.nombre}`);
    mostrar();
    if (nueva && S.servidor) { toast('Cámara agregada. Ahora puedes agregarle fotos con "Editar".'); }
  }, nueva ? null : async () => {
    const [quitada] = p.camaras.splice(i, 1);
    for (const f of quitada.fotos || []) await borrarFoto(f);
    await guardar(`cámara eliminada: ${quitada.nombre || ''} en ${p.nombre}`);
    mostrar();
  }, nueva ? { html: '<p class="vacio">Guarda la cámara primero; después podrás agregarle fotos con "Editar".</p>' } : seccionFotos(p, cam));
}

function editarProp(p) {
  const ct = p.contacto || {};
  formulario(`Editar propiedad · ${p.nombre}`, [
    { k: 'nombre', t: 'Nombre' }, { k: 'grupo', t: 'Grupo (vacío si es cliente directo)' },
    { k: 'razonSocial', t: 'Razón social', ancho: true },
    { k: 'monitoreo', t: 'Monitoreo', op: ['EN MONITOREO', 'SIN MONITOREO'] },
    { k: 'equipos', t: 'Equipos', op: ['PROPIEDAD DEL CLIENTE', 'RENTING'] },
    { k: 'estacion', t: 'Estación de monitoreo', op: listaEstaciones() },
    { k: 'ubicacion', t: 'Ubicación / sector' }, { k: 'mapa', t: 'Enlace de Google Maps' },
    { k: 'lat', t: 'Latitud', num: true }, { k: 'lng', t: 'Longitud', num: true },
    { k: 'cliente', t: 'Cliente' }, { k: 'responsable', t: 'Responsable' },
    { k: 'contacto', t: 'Jefe de seguridad o encargado' }, { k: 'cargo', t: 'Cargo' },
    { k: 'telefono', t: 'Teléfono' }, { k: 'referencia', t: 'Cómo llegar', area: true, ancho: true },
  ], { ...p, cliente: ct.cliente, responsable: ct.responsable, contacto: ct.nombre, cargo: ct.cargo, telefono: ct.telefono }, (v) => {
    Object.assign(p, { nombre: v.nombre || p.nombre, grupo: v.grupo, razonSocial: v.razonSocial, monitoreo: v.monitoreo || 'EN MONITOREO', equipos: v.equipos || null, estacion: v.estacion || null, ubicacion: v.ubicacion, mapa: v.mapa, lat: v.lat, lng: v.lng, referencia: v.referencia });
    p.contacto = { cliente: v.cliente, responsable: v.responsable, nombre: v.contacto, cargo: v.cargo, telefono: v.telefono };
    guardar(`propiedad ${p.nombre} editada`);
    mostrar();
  });
}

// ---------------- GPS ----------------
function tablaVehiculos(veh, v) {
  const conductor = veh.some((x) => x.conductor);
  return `<div class="tabla-scroll"><table><thead><tr><th>#</th><th>Placa / ID unidad</th>${conductor ? '<th>Conductor</th>' : ''}<th>Tipo</th><th>Estado</th><th>Plataforma</th><th>Horario</th>${v ? '<th class="n">Valor</th>' : ''}</tr></thead>
    <tbody>${veh.map((x, i) => `<tr><td>${i + 1}</td><td>${esc(x.placa)}</td>${conductor ? `<td>${esc(x.conductor)}</td>` : ''}<td>${esc(x.tipo)}</td><td>${chipEstado(x.estado)}</td><td>${esc(x.plataforma)}</td><td>${esc(x.horario)}</td>${v ? `<td class="n">${x.valor ? dinero(x.valor) : ''}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}
const sumaValor = (veh) => veh.reduce((s, x) => s + (Number(x.valor) || 0), 0);
const unidadesDe = (veh) => new Set(veh.map((x) => x.placa).filter(Boolean)).size;

function vGps(c) {
  const v = P().valores;
  c.innerHTML = `<div class="encabezado"><div><h1>GPS</h1><p>${S.datos.gps.length} clientes</p></div></div>` + S.datos.gps.map((g, gi) => {
    const veh = g.vehiculos || [];
    const ct = g.contacto || {};
    const razones = [];
    for (const x of veh) {
      if (!x.razon) continue;
      let r = razones.find((y) => y.nombre === x.razon);
      if (!r) razones.push((r = { nombre: x.razon, representante: x.representante, nota: x.nota, veh: [] }));
      r.veh.push(x);
    }
    const cabecera = `<div class="encabezado"><div><h2>${esc(g.cliente)}</h2></div><div>${unidadesDe(veh)} unidades${razones.length ? ` · ${razones.length} razones sociales` : ''}${v ? ' · ' + dinero(sumaValor(veh)) : ''}</div></div>
      <div class="datos">
        <div><small>Responsable</small>${esc(ct.responsable) || '<span class="vacio">Sin dato</span>'}</div>
        <div><small>Contacto</small>${esc(ct.nombre) || '<span class="vacio">Sin dato</span>'}${ct.cargo ? ` <span class="chip">${esc(ct.cargo)}</span>` : ''}</div>
        <div><small>Teléfono</small>${esc(ct.telefono) || '<span class="vacio">Sin dato</span>'}</div>
      </div>`;
    if (!razones.length) return `<div class="panel">${cabecera}<h3>Vehículos</h3>${tablaVehiculos(veh, v)}</div>`;
    return `<div class="panel">${cabecera}
      <h3>Razones sociales</h3>
      <div class="tabla-scroll"><table><thead><tr><th>#</th><th>Razón social</th><th>Representante</th><th>Según el archivo</th><th class="n">Unidades</th><th class="n">Choferes</th>${v ? '<th class="n">Valor</th>' : ''}</tr></thead>
      <tbody>${razones.map((r, i) => `<tr class="clic" data-ir="rs-${gi}-${i}"><td>${i + 1}</td><td><strong>${esc(r.nombre)}</strong></td><td>${esc(r.representante) || ''}</td><td>${esc(r.nota) || ''}</td><td class="n">${unidadesDe(r.veh)}</td><td class="n">${r.veh.filter((x) => x.conductor).length || ''}</td>${v ? `<td class="n">${dinero(sumaValor(r.veh))}</td>` : ''}</tr>`).join('')}</tbody>
      <tfoot><tr><td></td><td>Total</td><td></td><td></td><td class="n">${unidadesDe(veh)}</td><td class="n">${veh.filter((x) => x.conductor).length}</td>${v ? `<td class="n">${dinero(sumaValor(veh))}</td>` : ''}</tr></tfoot></table></div>
    </div>
    ${razones.map((r, i) => `<div class="panel razon" id="rs-${gi}-${i}">
      <div class="encabezado"><div><span class="chip grupo">${esc(g.cliente)}</span><h2>${esc(r.nombre)}</h2><p>${r.representante ? 'Representante: ' + esc(r.representante) + ' · ' : ''}${esc(r.nota || '')}</p></div>${v ? `<div>${dinero(sumaValor(r.veh))}</div>` : ''}</div>
      ${tablaVehiculos(r.veh, v)}
    </div>`).join('')}`;
  }).join('');
  c.querySelectorAll('[data-ir]').forEach((tr) => (tr.onclick = () => document.getElementById(tr.dataset.ir).scrollIntoView({ behavior: 'smooth', block: 'start' })));
}

// ---------------- Valores (no lo ve el departamento técnico) ----------------
function filasValores() {
  const filas = [];
  for (const [g, ps] of porGrupo(S.datos.propiedades)) {
    for (const p of ps) {
      filas.push({ seccion: 'CCTV', grupo: g, nombre: p.nombre, id: p.id, valor: stats(p).valor, obj: p,
        razon: p.razonSocial || '', sugerida: p.razonSocial ? '' : ((p.contacto || {}).cliente || '') });
    }
  }
  for (const g of S.datos.gps) {
    const veh = g.vehiculos || [];
    const razones = [...new Set(veh.map((x) => x.razon).filter(Boolean))];
    if (razones.length) {
      for (const r of razones) {
        const vr = veh.filter((x) => x.razon === r);
        filas.push({ seccion: 'GPS', grupo: g.cliente, nombre: '', razon: r, fija: true, valor: sumaValor(vr) });
      }
    } else {
      filas.push({ seccion: 'GPS', grupo: 'GPS', nombre: g.cliente, valor: sumaValor(veh), obj: g, razon: g.razonSocial || '', sugerida: '' });
    }
  }
  return filas;
}

function vValores(c) {
  const filas = filasValores();
  const ed = P().editar;
  const total = (f) => f.reduce((s, x) => s + x.valor, 0);
  const cctv = filas.filter((f) => f.seccion === 'CCTV');
  const gps = filas.filter((f) => f.seccion === 'GPS');
  const razonMostrada = (f) => f.razon || f.sugerida || '';
  c.innerHTML = `
    <div class="encabezado">
      <div><h1>Valores</h1><p>Valor por propiedad según los consolidados</p></div>
      <div class="acciones"><button class="btn prim" id="descargar">Descargar para Excel</button></div>
    </div>
    <div class="tarjetas">
      ${tarjeta('Total CCTV', dinero(total(cctv)), `${cctv.length} propiedades`)}
      ${tarjeta('Total GPS', dinero(total(gps)), `${S.datos.gps.length} clientes`)}
      ${tarjeta('Total general', dinero(total(filas)), 'CCTV + GPS')}
    </div>
    <div class="filtros"><input type="search" id="qv" placeholder="Buscar propiedad, grupo o razón social…"></div>
    ${ed ? '<p class="vacio">Para cambiar una razón social, pulsa el lápiz ✎ a su lado. Para ver la ficha de una propiedad, haz clic en su nombre.</p>' : ''}
    <div class="panel"><div class="tabla-scroll" id="tabla-valores"></div></div>`;
  const celdaRazon = (f, i) => {
    const texto = f.razon ? esc(f.razon) : (f.sugerida ? `<span class="vacio" title="Nombre de cliente en el archivo de coordenadas">${esc(f.sugerida)}</span>` : '<span class="vacio">Sin razón social</span>');
    if (f.fija || !ed) return texto;
    return `<div class="razon-ver"><span>${texto}</span><button type="button" class="lapiz" data-editar="${i}" title="Editar razón social" aria-label="Editar razón social">✎</button></div>`;
  };
  const pintar = () => {
    const t = normal($('#qv').value.trim());
    const vis = filas.filter((f) => !t || normal(f.nombre).includes(t) || normal(f.grupo).includes(t) || normal(razonMostrada(f)).includes(t));
    let html = '<table class="valores"><thead><tr><th>#</th><th>Propiedad / cliente</th><th>Razón social</th><th class="n">Valor</th></tr></thead><tbody>';
    let n = 0;
    for (const sec of ['CCTV', 'GPS']) {
      const fs = vis.filter((f) => f.seccion === sec);
      if (!fs.length) continue;
      html += `<tr class="sec"><td colspan="3">${sec}</td><td class="n">${dinero(total(fs))}</td></tr>`;
      const grupos = [...new Set(fs.map((f) => f.grupo))];
      for (const g of grupos) {
        const fg = fs.filter((f) => f.grupo === g);
        const conTitulo = !(sec === 'GPS' && g === 'GPS');
        if (conTitulo) html += `<tr class="grp"><td colspan="3">${esc(g)} <span class="vacio">(${fg.length})</span></td><td class="n">${dinero(total(fg))}</td></tr>`;
        html += fg.map((f) => `<tr${f.id ? ` class="clic" data-ir="#/cctv/${f.id}"` : ''}><td>${++n}</td><td class="${conTitulo ? 'sangria' : ''}">${f.nombre ? esc(f.nombre) : '<span class="vacio">—</span>'}</td><td class="razon">${celdaRazon(f, filas.indexOf(f))}</td><td class="n ${f.valor ? '' : 'vacio'}">${dinero(f.valor)}</td></tr>`).join('');
      }
    }
    html += `</tbody><tfoot><tr><td></td><td>Total${t ? ' (filtrado)' : ''}</td><td></td><td class="n">${dinero(total(vis))}</td></tr></tfoot></table>`;
    $('#tabla-valores').innerHTML = vis.length ? html : '<p class="vacio">Sin resultados</p>';
    // Clic en la fila (menos en la columna Razón social) abre la ficha de la propiedad
    $('#tabla-valores').querySelectorAll('[data-ir]').forEach((tr) => (tr.onclick = (e) => { if (!e.target.closest('td.razon')) location.hash = tr.dataset.ir; }));
    $('#tabla-valores').querySelectorAll('[data-editar]').forEach((b) => (b.onclick = (e) => {
      e.stopPropagation();
      const f = filas[Number(b.dataset.editar)];
      const td = b.closest('td');
      td.innerHTML = `<div class="razon-editar"><input type="text" class="razon-input" value="${esc(f.razon)}" placeholder="${esc(f.sugerida || 'Escribir razón social')}">
        <button type="button" class="lapiz ok" title="Guardar" aria-label="Guardar">✓</button><button type="button" class="lapiz no" title="Cancelar" aria-label="Cancelar">✕</button></div>`;
      const inp = td.querySelector('input');
      inp.focus();
      inp.select();
      const guardarRazon = async () => {
        const valor = inp.value.trim();
        if (valor !== (f.razon || '')) {
          f.obj.razonSocial = valor || null;
          f.razon = valor;
          f.sugerida = '';
          await guardar(`razón social de ${f.nombre}: ${valor || '(vacía)'}`);
        }
        pintar();
      };
      inp.onkeydown = (ev) => { if (ev.key === 'Enter') guardarRazon(); if (ev.key === 'Escape') pintar(); };
      td.querySelector('.ok').onclick = guardarRazon;
      td.querySelector('.no').onclick = () => pintar();
    }));
  };
  $('#qv').oninput = pintar;
  pintar();
  $('#descargar').onclick = () => {
    const num = (v) => Number(v || 0).toFixed(2).replace('.', ',');
    const lineas = [['Sección', 'Grupo / cliente', 'Propiedad', 'Razón social', 'Valor'].join(';')];
    for (const f of filas) lineas.push([f.seccion, f.grupo, f.nombre, razonMostrada(f), num(f.valor)].map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';'));
    lineas.push(['', '', '', 'TOTAL', num(total(filas))].map((x) => `"${x}"`).join(';'));
    const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `valores-telearseg-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
}

// ---------------- COSTANET ----------------
function vCostanet(c) {
  const nodos = S.datos.costanet;
  const cams = nodos.reduce((s, n) => s + (n.camaras || 0), 0);
  c.innerHTML = `
    <div class="panel encabezado"><div><img class="logo-costanet" src="img/costanet.png" alt="COSTANET"><p>${nodos.length} nodos · ${cams} cámaras</p></div></div>
    <div class="panel"><div class="tabla-scroll"><table>
      <thead><tr><th>#</th><th>Nodo</th><th>Contacto</th><th>Teléfono</th><th class="n">Cámaras</th><th>Ubicación</th><th>Referencia</th></tr></thead>
      <tbody>${nodos.map((n) => `<tr>
        <td>${n.num}</td><td><strong>${esc(n.nodo)}</strong></td>
        <td>${esc(n.contacto) || '<span class="vacio">Pendiente</span>'}</td>
        <td>${esc(n.telefono) || ''}</td><td class="n">${n.camaras}</td>
        <td>${n.lat != null ? `<a href="https://www.google.com/maps?q=${n.lat},${n.lng}" target="_blank" rel="noopener">Ver mapa</a>${n.coordenadaPorConfirmar ? ' <span class="chip e-por-ingresar">por confirmar</span>' : ''}` : '<span class="vacio">Pendiente</span>'}</td>
        <td>${esc(n.referencia) || '<span class="vacio">Pendiente</span>'}</td></tr>`).join('')}</tbody>
    </table></div></div>`;
}

// ---------------- Accesos (solo administrador) ----------------
async function vAccesos(c) {
  if (S.local) {
    c.innerHTML = `<div class="encabezado"><div><h1>Accesos</h1></div></div>
      <div class="panel"><p>Aquí verás <strong>quién entró y cuándo</strong>, y también los cambios que hagas.</p>
      <p class="vacio">Este registro empieza a funcionar cuando la página esté publicada en Cloudflare. En esta computadora no hay accesos que mostrar.</p></div>`;
    return;
  }
  c.innerHTML = '<p class="cargando">Cargando accesos…</p>';
  const r = await fetch('/api/accesos', { cache: 'no-store' });
  const lista = r.ok ? await r.json() : [];
  c.innerHTML = `<div class="encabezado"><div><h1>Accesos</h1><p>Últimos ${lista.length} registros</p></div></div>
    <div class="panel"><table><thead><tr><th>Fecha y hora</th><th>Usuario</th><th>Rol</th><th>Acción</th></tr></thead>
    <tbody>${lista.map((a) => `<tr><td>${esc(new Date(a.fecha).toLocaleString('es-EC'))}</td><td>${esc(a.correo)}</td><td>${esc((ROLES[a.rol] || {}).nombre || a.rol)}</td><td>${esc(a.accion)}</td></tr>`).join('')}</tbody></table></div>`;
}

iniciar();
