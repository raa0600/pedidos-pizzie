// ============================================================
// HERMES · Panel de administración
// ============================================================

// ---------- Helpers ----------
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s).replace(/[&<>"']/g,
  c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const formato = n => '$' + Number(n || 0).toFixed(2);

// ---------- Contexto ----------
const SLUG = (() => {
  const m = window.location.pathname.match(/^\/([a-z0-9-]+)/i);
  return m ? m[1].toLowerCase() : null;
})();

if (!SLUG) {
  document.body.innerHTML = '<p style="padding:40px">Falta el identificador del restaurante en la URL.</p>';
  throw new Error('Sin slug');
}

// ---------- Estado ----------
let usuario = null;
let ROL = null;
let CAPS = {};

let CONFIG = {
  slug: SLUG,
  nombre: 'Restaurante',
  tipo: 'otro',
  configuracion: {
    servicios: { retiro: true, delivery: false, dineIn: false },
    estados: [],
    tiempoEspera: 30,
  },
};
let pedidos = [];
let mesas = [];

let filtroEstado = 'activos';
let filtroServicio = 'todos';
let vistaActiva = 'pedidos';

let idsConocidos = new Set();
let primeraCarga = true;
let intervaloCarga = null;

let vistaGestion = 'menu';
let gestionCargada = false;
let gestionMenu = [];
let gestionCategorias = [];
let gestionUsuarios = [];
let gestionConfig = null;

// ---------- Helper de colores ----------
function aplicarColoresDelTenant(config) {
  if (!config || !config.colorAcento) return;
  const root = document.documentElement;
  const color = config.colorAcento;

  root.style.setProperty('--acento', color);
  root.style.setProperty('--acento-hover', oscurecerHex(color, 20));
  root.style.setProperty('--acento-suave', hexARgba(color, 0.08));
}

function oscurecerHex(hex, porcentaje) {
  try {
    const n = parseInt(hex.replace('#', ''), 16);
    const factor = 1 - porcentaje / 100;
    const r = Math.round(((n >> 16) & 255) * factor);
    const g = Math.round(((n >> 8) & 255) * factor);
    const b = Math.round((n & 255) * factor);
    return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
  } catch { return hex; }
}

function hexARgba(hex, alpha) {
  try {
    const n = parseInt(hex.replace('#', ''), 16);
    const r = (n >> 16) & 255;
    const g = (n >> 8) & 255;
    const b = n & 255;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  } catch { return hex; }
}

// ---------- Capacidades por rol ----------
function definirCapacidades() {
  ROL = usuario.rol;
  CAPS = {
    verPrecios:         ['owner', 'caja'].includes(ROL),
    cancelar:           ['owner', 'caja'].includes(ROL),
    verCancelados:      ['owner', 'caja'].includes(ROL),
    avanzar:            ['owner', 'cocina', 'caja'].includes(ROL),
    verPedidos:         ['owner', 'cocina', 'caja'].includes(ROL),
    verMesas:           ['owner', 'caja', 'mesero'].includes(ROL),
    cerrarMesa:         ['owner', 'caja', 'mesero'].includes(ROL),
    verFiltrosServicio: ['owner', 'caja'].includes(ROL),
    verFiltrosEstado:   ['owner', 'cocina', 'caja'].includes(ROL),
    verGestion:         ROL === 'owner',
  };

  if (ROL === 'mesero') vistaActiva = 'mesas';
  else vistaActiva = 'pedidos';
}

// ---------- Auth ----------
async function chequearSesion() {
  try {
    const res = await fetch(`/api/${SLUG}/auth/me`, { credentials: 'include' });
    if (res.ok) {
      const data = await res.json();
      usuario = data.usuario;
      CONFIG.nombre = data.tenant.nombre;
      CONFIG.tipo = data.tenant.tipo;
      await cargarConfig();

      if (usuario.debeCambiarPassword) {
        mostrarCambioPasswordObligatorio();
        return true;
      }

      definirCapacidades();
      arrancarPanel();
      return true;
    }
  } catch { }
  mostrarLogin();
  return false;
}

async function cargarConfig() {
  try {
    const res = await fetch(`/api/${SLUG}/config`);
    if (res.ok) {
      const data = await res.json();
      CONFIG = { ...CONFIG, ...data };
      aplicarColoresDelTenant(CONFIG.configuracion);
    }
  } catch { }
}

function mostrarLogin() {
  document.body.innerHTML = `
    <div class="login-wrap">
      <div class="login-lado">
        <div class="marca">
          <img class="logo-marca" src="/logo.svg" alt="" aria-hidden="true">
          <span>Hermes</span>
        </div>
        <h1>Panel<br>de<br>pedidos.</h1>
        <p class="pie">Acceso restringido · v2.0</p>
      </div>
      <div class="login-form-wrap">
        <form class="login-card" id="form-login">
          <h2 id="login-nombre">Iniciar sesión</h2>
          <label>Email
            <input type="email" name="email" required autocomplete="username" />
          </label>
          <label>Contraseña
            <input type="password" name="password" required autocomplete="current-password" />
          </label>
          <p class="login-error" id="login-error"></p>
          <button type="submit" class="btn btn-primario btn-grande">Entrar</button>
        </form>
      </div>
    </div>
  `;

  fetch(`/api/${SLUG}/config`)
    .then(r => r.json())
    .then(cfg => {
      const el = document.getElementById('login-nombre');
      if (el) el.textContent = cfg.nombre;
      document.title = `${cfg.nombre} · Panel`;
      aplicarColoresDelTenant(cfg.configuracion);
    })
    .catch(() => { });

  document.getElementById('form-login').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type=submit]');
    const err = document.getElementById('login-error');
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Entrando…';

    try {
      const res = await fetch(`/api/${SLUG}/auth/login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: f.email.value.trim(),
          password: f.password.value,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión');
      usuario = data.usuario;
      window.location.reload();
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  };
}

function mostrarCambioPasswordObligatorio() {
  document.body.innerHTML = `
    <div class="login-wrap">
      <div class="login-lado">
        <div class="marca">
          <img class="logo-marca" src="/logo.svg" alt="" aria-hidden="true">
          <span>Hermes</span>
        </div>
        <h1>Cambiar<br>contraseña.</h1>
        <p class="pie">Por seguridad</p>
      </div>
      <div class="login-form-wrap">
        <form class="login-card" id="form-cambio">
          <h2>Cambiar contraseña</h2>
          <p style="font-size: 0.85rem; color: var(--negro-60); margin-bottom: 8px;">
            Tu contraseña actual es temporal. Debes cambiarla para continuar.
          </p>
          <label>Contraseña actual
            <input type="password" name="passwordActual" required autocomplete="current-password" />
          </label>
          <label>Nueva contraseña (mínimo 8 caracteres)
            <input type="password" name="passwordNueva" required minlength="8" autocomplete="new-password" />
          </label>
          <label>Confirmar nueva contraseña
            <input type="password" name="passwordConfirm" required minlength="8" autocomplete="new-password" />
          </label>
          <p class="login-error" id="login-error"></p>
          <button type="submit" class="btn btn-primario btn-grande">Cambiar contraseña</button>
        </form>
      </div>
    </div>
  `;

  document.getElementById('form-cambio').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type=submit]');
    const err = document.getElementById('login-error');
    err.textContent = '';

    if (f.passwordNueva.value !== f.passwordConfirm.value) {
      err.textContent = 'Las contraseñas no coinciden';
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Cambiando…';

    try {
      const res = await fetch(`/api/${SLUG}/auth/cambiar-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          passwordActual: f.passwordActual.value,
          passwordNueva: f.passwordNueva.value,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al cambiar');

      usuario.debeCambiarPassword = false;
      definirCapacidades();
      arrancarPanel();
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
      btn.textContent = 'Cambiar contraseña';
    }
  };
}

// ---------- Arranque del panel ----------
async function arrancarPanel() {
  const titulo = {
    owner: 'Panel',
    cocina: 'Cocina',
    caja: 'Caja',
    mesero: 'Mesas',
  }[ROL] || 'Panel';

  document.body.innerHTML = `
    <header class="topbar">
      <div class="marca">
        <img class="logo-marca" src="/logo.svg" alt="" aria-hidden="true">
        <span id="marca-nombre">${esc(CONFIG.nombre)}</span>
        <span class="rol-tag-topbar">${esc(ROL)}</span>
      </div>
      <div class="acciones">
        <span class="rol-badge">${esc(usuario.nombre)}</span>
        <span id="contador" class="badge">0</span>
        ${ROL === 'owner' ? `<button id="btn-qr" class="btn">${icono('qr')} QR Mesas</button>` : ''}
        <button id="btn-refrescar" class="btn">${icono('actualizar')} Actualizar</button>
        <button id="btn-salir" class="btn">${icono('cerrar_sesion')} Salir</button>
      </div>
    </header>
    <main class="contenedor">
      <div id="tabs-vista" class="tabs-vista"></div>
      <div id="filtros-servicio" class="filtros-servicio"></div>
      <div id="filtros-estado" class="filtros"></div>
      <div id="contenido"></div>
    </main>
    <div id="modal-gestion" class="modal oculto"></div>
  `;

  document.title = `${CONFIG.nombre} · ${titulo}`;

  document.getElementById('btn-refrescar').onclick = () => {
    if (vistaActiva === 'gestion') cargarGestion(true);
    else cargarTodo();
  };
  const btnQR = document.getElementById('btn-qr');
  if (btnQR) {
    btnQR.onclick = () => {
      window.open(`/${SLUG}/mesas/imprimir-qr`, '_blank');
    };
  }
  document.getElementById('btn-salir').onclick = async () => {
    await fetch(`/api/${SLUG}/auth/logout`, { method: 'POST', credentials: 'include' });
    window.location.reload();
  };

  await cargarTodo();
  intervaloCarga = setInterval(() => {
    if (vistaActiva !== 'gestion') cargarTodo();
  }, 5000);

  document.addEventListener('click', onGlobalClick);
}

// ---------- Carga de datos ----------
async function cargarTodo() {
  const promesas = [cargarPedidos()];
  if (CAPS.verMesas && CONFIG.configuracion.servicios?.dineIn) {
    promesas.push(cargarMesas());
  }
  await Promise.all(promesas);
  detectarNuevos();
  render();
}

async function cargarPedidos() {
  try {
    const res = await fetch(`/api/${SLUG}/pedidos`, { credentials: 'include' });
    if (res.status === 401) { window.location.reload(); return; }
    if (!res.ok) return;
    pedidos = await res.json();
  } catch (e) { console.error(e); }
}

async function cargarMesas() {
  if (!CONFIG.configuracion.servicios?.dineIn) return;
  try {
    const res = await fetch(`/api/${SLUG}/mesas`, { credentials: 'include' });
    if (!res.ok) return;
    mesas = await res.json();
  } catch (e) { console.error(e); }
}

function detectarNuevos() {
  const nuevos = pedidos.filter(p => !idsConocidos.has(p.id));
  if (!primeraCarga && nuevos.length > 0) beep();
  pedidos.forEach(p => idsConocidos.add(p.id));
  primeraCarga = false;
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch { }
}

// ---------- Utilidades de estado ----------
function estadosDisponibles() { return CONFIG.configuracion.estados || []; }

function esEstadoActivo(estadoId) {
  const estados = estadosDisponibles();
  const idx = estados.findIndex(e => e.id === estadoId);
  const idxEntregado = estados.findIndex(e => e.id === 'entregado');
  const idxCancelado = estados.findIndex(e => e.id === 'cancelado');
  if (idx === -1) return false;
  if (idxCancelado !== -1 && idx >= idxCancelado) return false;
  if (idxEntregado !== -1 && idx >= idxEntregado) return false;
  return true;
}

function estadoSiguiente(estadoId) {
  const e = estadosDisponibles().find(x => x.id === estadoId);
  return e?.siguiente || null;
}

function labelEstado(estadoId) {
  const e = estadosDisponibles().find(x => x.id === estadoId);
  return e?.label || estadoId;
}

// ---------- Render ----------
function render() {
  renderTabsVista();
  renderFiltrosServicio();
  renderFiltrosEstado();
  renderContenido();
  actualizarContador();
}

function actualizarContador() {
  const activos = pedidos.filter(p => esEstadoActivo(p.estado));
  const el = document.getElementById('contador');
  if (el) el.textContent = activos.length;
}

function renderTabsVista() {
  const el = document.getElementById('tabs-vista');
  if (!el) return;

  const tabs = [];
  if (CAPS.verPedidos) tabs.push({ id: 'pedidos', label: ROL === 'cocina' ? 'Cocina' : 'Pedidos' });
  if (CAPS.verMesas && CONFIG.configuracion.servicios?.dineIn) {
    const ocupadas = mesas.filter(m => m.estado !== 'libre').length;
    tabs.push({ id: 'mesas', label: `Mesas (${ocupadas}/${mesas.length})` });
  }
  if (CAPS.verCancelados) {
    const cancelados = pedidos.filter(p => p.estado === 'cancelado').length;
    tabs.push({ id: 'cancelados', label: `Cancelados (${cancelados})` });
  }
  if (CAPS.verGestion) {
    tabs.push({ id: 'gestion', label: 'Gestión' });
  }

  if (!tabs.find(t => t.id === vistaActiva)) {
    vistaActiva = tabs[0]?.id || 'pedidos';
  }

  el.innerHTML = tabs.map(t => `
    <button class="tab-vista ${vistaActiva === t.id ? 'activo' : ''}" data-vista="${t.id}">
      ${esc(t.label)}
    </button>
  `).join('');
}

function renderFiltrosServicio() {
  const el = document.getElementById('filtros-servicio');
  if (!el) return;

  if (!CAPS.verFiltrosServicio || vistaActiva !== 'pedidos') {
    el.innerHTML = '';
    return;
  }

  const servicios = CONFIG.configuracion.servicios || {};
  const hayVarios = [servicios.retiro, servicios.delivery, servicios.dineIn].filter(Boolean).length > 1;

  if (!hayVarios) { el.innerHTML = ''; return; }

  const opciones = [['todos', 'Todos']];
  if (servicios.retiro) opciones.push(['retiro', 'Retiro']);
  if (servicios.delivery) opciones.push(['delivery', 'Delivery']);
  if (servicios.dineIn) opciones.push(['dineIn', 'En mesa']);

  el.innerHTML = opciones.map(([id, label]) => `
    <button class="chip-servicio ${filtroServicio === id ? 'activo' : ''}" data-servicio-filtro="${id}">
      ${esc(label)}
    </button>
  `).join('');
}

function renderFiltrosEstado() {
  const el = document.getElementById('filtros-estado');
  if (!el) return;

  if (!CAPS.verFiltrosEstado || vistaActiva !== 'pedidos') {
    el.innerHTML = '';
    return;
  }

  const activos = pedidos.filter(p => esEstadoActivo(p.estado));
  const estados = estadosDisponibles();

  const chips = [['activos', `Activos (${activos.length})`]];
  for (const e of estados) {
    if (e.id === 'cancelado') continue;
    const count = pedidos.filter(p => p.estado === e.id).length;
    chips.push([e.id, `${e.label} (${count})`]);
  }
  if (CAPS.verPrecios) {
    chips.push(['todos', `Todos (${pedidos.length})`]);
  }

  el.innerHTML = chips.map(([id, label]) => `
    <button class="chip ${filtroEstado === id ? 'activo' : ''}" data-filtro="${id}">
      ${esc(label)}
    </button>
  `).join('');
}

function renderContenido() {
  const el = document.getElementById('contenido');
  if (!el) return;

  if (vistaActiva === 'mesas') { el.innerHTML = renderVistaMesas(); return; }
  if (vistaActiva === 'cancelados') { el.innerHTML = renderVistaCancelados(); return; }
  if (vistaActiva === 'gestion') { el.innerHTML = renderGestion(); return; }

  el.innerHTML = renderVistaPedidos();
}

// ---------- Vista de pedidos ----------
function renderVistaPedidos() {
  let lista = pedidos;

  if (filtroServicio !== 'todos' && CAPS.verFiltrosServicio) {
    lista = lista.filter(p => p.tipoServicio === filtroServicio);
  }

  if (filtroEstado === 'activos') {
    lista = lista.filter(p => esEstadoActivo(p.estado));
  } else if (filtroEstado === 'cancelado') {
    lista = lista.filter(p => p.estado === 'cancelado');
  } else if (filtroEstado !== 'todos' || !CAPS.verPrecios) {
    lista = lista.filter(p => p.estado === filtroEstado);
  }

  if (ROL === 'cocina') {
    lista = lista.filter(p => esEstadoActivo(p.estado));
  }

  lista = [...lista].sort((a, b) => {
    const aAct = esEstadoActivo(a.estado);
    const bAct = esEstadoActivo(b.estado);
    if (aAct && !bAct) return -1;
    if (!aAct && bAct) return 1;
    if (aAct) return new Date(a.creado) - new Date(b.creado);
    return new Date(b.creado) - new Date(a.creado);
  });

  if (lista.length === 0) {
    const vacioMsg = ROL === 'cocina'
      ? 'No hay pedidos pendientes en cocina.'
      : 'No hay pedidos en esta vista.';
    return `<p class="vacio">${vacioMsg}</p>`;
  }

  return `<div class="pedidos">${lista.map(tarjetaPedido).join('')}</div>`;
}

function tarjetaPedido(p) {
  const hora = new Date(p.creado).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  const siguiente = estadoSiguiente(p.estado);
  const activo = esEstadoActivo(p.estado);
  const esCocina = ROL === 'cocina';

  return `
    <article class="pedido estado-${p.estado} ${esCocina ? 'pedido-cocina' : ''}">
      <header>
        <div>
          <strong>#${esc(p.id)}</strong>
          <span class="hora">${hora}</span>
        </div>
        <div class="tag-servicio">
          <span class="tag">${labelEstado(p.estado)}</span>
          ${etiquetaServicio(p)}
        </div>
      </header>

      ${!esCocina ? `
        <p class="cliente">${icono('usuario')} ${esc(p.cliente.nombre)}${p.cliente.telefono ? ` · ${esc(p.cliente.telefono)}` : ''}</p>
        ${infoServicio(p)}
      ` : `
        <p class="cliente">${infoServicioCorto(p)}</p>
      `}

      <ul class="items ${esCocina ? 'items-cocina' : ''}">
        ${p.items.map(i => lineaItem(i, esCocina)).join('')}
      </ul>

      ${p.notas ? `<p class="notas">${icono('nota')} ${esc(p.notas)}</p>` : ''}

      <footer>
        ${CAPS.verPrecios ? `
          <div class="pedido-desglose">
            <div class="pedido-desglose-linea">
              <span>Subtotal</span>
              <strong>${formato(p.subtotal)}</strong>
            </div>
            <div class="pedido-desglose-linea">
              <span>IVA 16%</span>
              <strong>${formato(p.iva)}</strong>
            </div>
            ${p.costoEnvio > 0 ? `
              <div class="pedido-desglose-linea">
                <span>Envío ${p.zonaDelivery ? `· ${esc(p.zonaDelivery)}` : ''}</span>
                <strong>${formato(p.costoEnvio)}</strong>
              </div>
            ` : ''}
            <div class="pedido-desglose-total">
              <strong class="total">${formato(p.total)}</strong>
            </div>
          </div>
        ` : ''}
        <div class="botones">
          ${siguiente && activo && CAPS.avanzar
            ? `<button class="btn btn-primario ${esCocina ? 'btn-grande-cocina' : ''}" data-avanzar="${p.id}">
                 ${textoBotonAvanzar(p)}
               </button>`
            : ''}
          ${activo && CAPS.cancelar
            ? `<button class="btn btn-peligro" data-cancelar="${p.id}">Cancelar</button>`
            : ''}
        </div>
      </footer>
    </article>
  `;
}

function textoBotonAvanzar(p) {
  const siguiente = estadoSiguiente(p.estado);
  if (ROL === 'caja' && p.estado === 'listo') return 'Cobrar y entregar';
  return labelEstado(siguiente);
}

function etiquetaServicio(p) {
  if (p.tipoServicio === 'dineIn' && p.mesa?.numero) {
    return `<span class="tag-servicio-badge">${icono('silla')} Mesa ${p.mesa.numero}</span>`;
  }
  if (p.tipoServicio === 'delivery') {
    return `<span class="tag-servicio-badge">${icono('moto')} Delivery</span>`;
  }
  return `<span class="tag-servicio-badge">${icono('casa')} Retiro</span>`;
}

function infoServicio(p) {
  if (p.tipoServicio === 'delivery' && p.direccion) {
    return `<p class="cliente">${icono('ubicacion')} ${esc(p.direccion)}${p.zonaDelivery ? ` · ${esc(p.zonaDelivery)}` : ''}</p>`;
  }
  if (p.tipoServicio === 'dineIn' && p.mesa?.numero) {
    return `<p class="cliente">${icono('silla')} Mesa ${p.mesa.numero}</p>`;
  }
  return `<p class="cliente">${icono('casa')} Retiro en local</p>`;
}

function infoServicioCorto(p) {
  if (p.tipoServicio === 'dineIn' && p.mesa?.numero) return `${icono('silla')} Mesa ${p.mesa.numero}`;
  if (p.tipoServicio === 'delivery') return `${icono('moto')} Delivery`;
  return `${icono('casa')} Retiro`;
}

function lineaItem(i, esCocina = false) {
  const detalles = [];
  if (i.variante) detalles.push(i.variante);
  if (i.extras && i.extras.length > 0) {
    detalles.push(...i.extras.map(e => e.cantidad > 1 ? `${e.nombre} x${e.cantidad}` : e.nombre));
  }
  if (i.opciones && i.opciones.length > 0) {
    detalles.push(...i.opciones.map(o => o.valor));
  }

  const detalle = detalles.length > 0
    ? `<span class="item-detalle ${esCocina ? 'detalle-grande' : ''}">${esc(detalles.join(' · '))}</span>`
    : '';

  const nota = i.notas
    ? `<span class="item-nota ${esCocina ? 'nota-grande' : ''}">${icono('nota')} ${esc(i.notas)}</span>`
    : '';

  return `
    <li>
      <div class="item-info">
        <span class="item-cantidad ${esCocina ? 'cant-grande' : ''}">${i.cantidad}×</span>
        <span class="item-nombre ${esCocina ? 'nombre-grande' : ''}">${esc(i.nombre)}</span>
        ${detalle}
        ${nota}
      </div>
      ${CAPS.verPrecios ? `<span class="item-precio">${formato(i.subtotal)}</span>` : ''}
    </li>
  `;
}

// ---------- Vista de cancelados ----------
function renderVistaCancelados() {
  let lista = pedidos.filter(p => p.estado === 'cancelado');

  lista = [...lista].sort((a, b) => {
    const fa = a.canceladoEn ? new Date(a.canceladoEn) : new Date(a.actualizado || a.creado);
    const fb = b.canceladoEn ? new Date(b.canceladoEn) : new Date(b.actualizado || b.creado);
    return fb - fa;
  });

  if (lista.length === 0) {
    return '<p class="vacio">No hay pedidos cancelados.</p>';
  }

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const canceladosHoy = lista.filter(p => {
    const f = p.canceladoEn ? new Date(p.canceladoEn) : new Date(p.actualizado || p.creado);
    return f >= hoy;
  }).length;

  const totalCanceladoHoy = lista
    .filter(p => {
      const f = p.canceladoEn ? new Date(p.canceladoEn) : new Date(p.actualizado || p.creado);
      return f >= hoy;
    })
    .reduce((s, p) => s + (p.total || 0), 0);

  return `
    <div class="cancelados-header">
      <div class="cancelados-metrica">
        <span class="metrica-label">Cancelados hoy</span>
        <strong class="metrica-valor">${canceladosHoy}</strong>
      </div>
      <div class="cancelados-metrica">
        <span class="metrica-label">Monto hoy</span>
        <strong class="metrica-valor">${formato(totalCanceladoHoy)}</strong>
      </div>
      <div class="cancelados-metrica">
        <span class="metrica-label">Total histórico</span>
        <strong class="metrica-valor">${lista.length}</strong>
      </div>
    </div>

    <div class="pedidos">
      ${lista.map(p => tarjetaCancelado(p)).join('')}
    </div>
  `;
}

function tarjetaCancelado(p) {
  const creadoHora = new Date(p.creado).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  const canceladoFecha = p.canceladoEn
    ? new Date(p.canceladoEn).toLocaleString('es', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
    : '(sin registro)';

  return `
    <article class="pedido estado-cancelado">
      <header>
        <div>
          <strong>#${esc(p.id)}</strong>
          <span class="hora">${creadoHora}</span>
        </div>
        <div class="tag-servicio">
          <span class="tag">CANCELADO</span>
          ${etiquetaServicio(p)}
        </div>
      </header>

      <div class="auditoria-cancelado">
        <div class="auditoria-fila">
          <span class="auditoria-label">Cancelado</span>
          <span class="auditoria-valor">${canceladoFecha}</span>
        </div>
        <div class="auditoria-fila">
          <span class="auditoria-label">Por</span>
          <span class="auditoria-valor">${esc(p.canceladoPor || '—')} · ${esc(p.canceladoPorRol || '')}</span>
        </div>
        <div class="auditoria-fila">
          <span class="auditoria-label">Desde</span>
          <span class="auditoria-valor">${esc(p.canceladoDesdeEstado || '—')}</span>
        </div>
        ${p.razonCancelacion ? `
          <div class="auditoria-fila">
            <span class="auditoria-label">Razón</span>
            <span class="auditoria-valor">${esc(p.razonCancelacion)}</span>
          </div>
        ` : ''}
      </div>

      <p class="cliente">${icono('usuario')} ${esc(p.cliente.nombre)}${p.cliente.telefono ? ` · ${esc(p.cliente.telefono)}` : ''}</p>

      ${infoServicio(p)}

      <ul class="items">
        ${p.items.map(i => lineaItem(i, false)).join('')}
      </ul>

      ${CAPS.verPrecios ? `
        <footer>
          <div class="pedido-desglose">
            <div class="pedido-desglose-total">
              <strong class="total">${formato(p.total)}</strong>
            </div>
          </div>
        </footer>
      ` : ''}
    </article>
  `;
}

// ---------- Vista de mesas ----------
function renderVistaMesas() {
  if (mesas.length === 0) return '<p class="vacio">No hay mesas configuradas.</p>';
  return `<div class="mesas-grid">${mesas.map(m => tarjetaMesa(m)).join('')}</div>`;
}

function tarjetaMesa(m) {
  const pedidosMesa = pedidos.filter(p =>
    p.tipoServicio === 'dineIn'
    && p.mesa?.numero === m.numero
    && esEstadoActivo(p.estado)
  );

  const totalMesa = pedidosMesa.reduce((s, p) => s + p.total, 0);
  const ocupada = pedidosMesa.length > 0;

  return `
    <article class="mesa estado-${ocupada ? 'ocupada' : 'libre'}">
      <header>
        <strong class="mesa-numero">Mesa ${m.numero}</strong>
        <span class="mesa-estado">${ocupada ? 'ocupada' : 'libre'}</span>
      </header>
      <div class="mesa-info">
        ${ocupada
          ? `
            <p class="mesa-pedidos">${pedidosMesa.length} pedido${pedidosMesa.length > 1 ? 's' : ''} activo${pedidosMesa.length > 1 ? 's' : ''}</p>
            ${CAPS.verPrecios ? `<p class="mesa-total">${formato(totalMesa)}</p>` : ''}
            <div class="mesa-acciones">
              ${CAPS.cerrarMesa ? `<button class="btn btn-primario" data-ver-mesa="${m.numero}">Ver cuenta</button>` : ''}
              ${CAPS.verPrecios ? `<button class="btn" data-ticket-mesa="${m.numero}">${icono('ticket')} Ticket</button>` : ''}
            </div>
          `
          : '<p class="mesa-libre">Disponible</p>'
        }
      </div>
    </article>
  `;
}

// ---------- Modal de cuenta ----------
function abrirModalCuenta(numeroMesa) {
  const pedidosMesa = pedidos.filter(p =>
    p.tipoServicio === 'dineIn' && p.mesa?.numero === numeroMesa && esEstadoActivo(p.estado)
  );

  if (pedidosMesa.length === 0) { alert('No hay pedidos activos en esta mesa'); return; }

  let subtotalTotal = 0, ivaTotal = 0;
  for (const p of pedidosMesa) {
    subtotalTotal += p.subtotal || 0;
    ivaTotal += p.iva || 0;
  }
  const totalMesa = +(subtotalTotal + ivaTotal).toFixed(2);

  let modal = document.getElementById('modal-cuenta');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'modal-cuenta';
    modal.className = 'modal';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal-overlay" data-cerrar-modal></div>
    <div class="modal-contenido">
      <div class="modal-head">
        <h2>${icono('silla')} Cuenta · Mesa ${numeroMesa}</h2>
        <button class="btn-icono" data-cerrar-modal type="button">${icono('equis')}</button>
      </div>
      <div class="modal-body">
        <div class="cuenta-pedidos">
          ${pedidosMesa.map(p => `
            <div class="cuenta-pedido">
              <div class="cuenta-pedido-head">
                <span class="cuenta-pedido-cliente">${icono('usuario')} ${esc(p.cliente.nombre)}</span>
                <span class="cuenta-pedido-hora">${new Date(p.creado).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}</span>
                <span class="cuenta-pedido-estado">${labelEstado(p.estado)}</span>
              </div>
              <ul class="cuenta-items">
                ${p.items.map(i => `
                  <li>
                    <span class="cuenta-item-cant">${i.cantidad}×</span>
                    <span class="cuenta-item-nombre">${esc(i.nombre)}</span>
                    ${CAPS.verPrecios ? `<span class="cuenta-item-precio">${formato(i.subtotal)}</span>` : ''}
                  </li>
                `).join('')}
              </ul>
              ${CAPS.verPrecios ? `
                <div class="cuenta-pedido-subtotal">
                  <span>Subtotal de ${esc(p.cliente.nombre.split(' ')[0])}</span>
                  <strong>${formato(p.total)}</strong>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>

        ${CAPS.verPrecios ? `
          <div class="cuenta-desglose">
            <div class="desglose-linea">
              <span>Subtotal</span>
              <strong>${formato(subtotalTotal)}</strong>
            </div>
            <div class="desglose-linea">
              <span>IVA 16%</span>
              <strong>${formato(ivaTotal)}</strong>
            </div>
            <div class="total">
              <span>Total mesa</span>
              <strong>${formato(totalMesa)}</strong>
            </div>
          </div>
        ` : ''}
      </div>
      <div class="modal-footer">
        <button class="btn" data-cerrar-modal type="button">Cerrar</button>
        <button class="btn btn-primario" data-cerrar-mesa="${numeroMesa}" type="button">
          Cerrar cuenta y liberar
        </button>
      </div>
    </div>
  `;

  modal.classList.remove('oculto');
  document.body.style.overflow = 'hidden';
}

function cerrarModalCuenta() {
  const modal = document.getElementById('modal-cuenta');
  if (!modal) return;
  modal.classList.add('oculto');
  modal.innerHTML = '';
  document.body.style.overflow = '';
}

async function cerrarCuentaMesa(numeroMesa) {
  if (!await confirmar(`¿Cerrar la cuenta de la mesa ${numeroMesa}? Todos los pedidos se marcarán como entregados.`, { titulo: 'Cerrar cuenta', textoAceptar: 'Cerrar cuenta' })) return;

  try {
    const res = await fetch(`/api/${SLUG}/mesas/${numeroMesa}/cerrar`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo cerrar la cuenta');

    cerrarModalCuenta();
    await cargarTodo();
  } catch (err) {
    alert(err.message);
  }
}

// ============================================================
// GESTIÓN
// ============================================================

async function cargarGestion(forzar = false) {
  if (gestionCargada && !forzar) return;

  try {
    const [menuRes, usuariosRes, configRes] = await Promise.all([
      fetch(`/api/${SLUG}/gestion/menu`, { credentials: 'include' }),
      fetch(`/api/${SLUG}/gestion/usuarios`, { credentials: 'include' }),
      fetch(`/api/${SLUG}/gestion/config`, { credentials: 'include' }),
    ]);

    if (!menuRes.ok || !usuariosRes.ok || !configRes.ok) {
      console.error('Error cargando datos de gestión');
      return;
    }

    const menuData = await menuRes.json();
    gestionMenu = menuData.items;
    gestionCategorias = menuData.categorias;
    gestionUsuarios = await usuariosRes.json();
    gestionConfig = await configRes.json();

    gestionCargada = true;
  } catch (e) { console.error(e); }
}

function renderGestion() {
  if (!gestionCargada) {
    cargarGestion().then(() => render());
    return '<p class="vacio">Cargando datos…</p>';
  }

  const subtabs = [
    ['menu', 'Menú'],
    ['usuarios', 'Usuarios'],
    ['config', 'Configuración'],
    ['mi-cuenta', 'Mi cuenta'],
  ];

  return `
    <div class="gestion-subtabs">
      ${subtabs.map(([id, label]) => `
        <button class="subtarea-tab ${vistaGestion === id ? 'activo' : ''}" data-gestion="${id}">
          ${esc(label)}
        </button>
      `).join('')}
    </div>
    <div class="gestion-contenido">
      ${vistaGestion === 'menu' ? renderGestionMenu() : ''}
      ${vistaGestion === 'usuarios' ? renderGestionUsuarios() : ''}
      ${vistaGestion === 'config' ? renderGestionConfig() : ''}
      ${vistaGestion === 'mi-cuenta' ? renderGestionMiCuenta() : ''}
    </div>
  `;
}

// ---------- Gestión: Menú ----------
function renderGestionMenu() {
  const porCategoria = {};
  for (const item of gestionMenu) {
    if (!porCategoria[item.categoria]) porCategoria[item.categoria] = [];
    porCategoria[item.categoria].push(item);
  }

  const total = gestionMenu.length;

  return `
    <div class="gestion-header">
      <div>
        <h3>Menú (${total} platillos)</h3>
        <p class="gestion-desc">Agrega, edita o elimina platillos del menú.</p>
      </div>
      <button class="btn btn-primario" data-nuevo-platillo>${icono('mas')} Nuevo platillo</button>
    </div>

    ${total === 0 ? `
      <p class="vacio">El menú está vacío. Agrega tu primer platillo.</p>
    ` : `
      ${Object.keys(porCategoria).sort().map(cat => `
        <div class="gestion-categoria">
          <h4 class="gestion-cat-titulo">${esc(cat)} (${porCategoria[cat].length})</h4>
          <div class="gestion-items">
            ${porCategoria[cat]
              .sort((a, b) => (a.orden || 0) - (b.orden || 0))
              .map(item => tarjetaGestionItem(item))
              .join('')}
          </div>
        </div>
      `).join('')}
    `}
  `;
}

function tarjetaGestionItem(item) {
  const precioTexto = item.variantes && item.variantes.length > 0
    ? `Desde ${formato(Math.min(...item.variantes.map(v => v.precio)))}`
    : formato(item.precio || 0);

  return `
    <div class="gestion-item ${!item.disponible ? 'no-disponible' : ''}">
      <div class="gestion-item-info">
        <div class="gestion-item-nombre">
          ${esc(item.nombre)}
          ${!item.disponible ? '<span class="tag-no-disp">NO DISPONIBLE</span>' : ''}
        </div>
        <div class="gestion-item-meta">
          <span class="gestion-item-precio">${precioTexto}</span>
          ${item.variantes?.length > 0 ? `<span class="gestion-item-tag">${item.variantes.length} variantes</span>` : ''}
          ${item.extras?.length > 0 ? `<span class="gestion-item-tag">${item.extras.length} extras</span>` : ''}
          ${item.opciones?.length > 0 ? `<span class="gestion-item-tag">${item.opciones.length} opciones</span>` : ''}
        </div>
      </div>
      <div class="gestion-item-acciones">
        <button class="btn" data-editar-platillo="${item._id}">${icono('lapiz')} Editar</button>
        <button class="btn btn-peligro" data-eliminar-platillo="${item._id}">${icono('basura')} Eliminar</button>
      </div>
    </div>
  `;
}

// ---------- Gestión: Usuarios ----------
function renderGestionUsuarios() {
  return `
    <div class="gestion-header">
      <div>
        <h3>Usuarios (${gestionUsuarios.length})</h3>
        <p class="gestion-desc">Crea usuarios para tu personal. Cada uno podrá entrar a su propio panel.</p>
      </div>
      <button class="btn btn-primario" data-nuevo-usuario>${icono('persona_mas')} Nuevo usuario</button>
    </div>

    ${gestionUsuarios.length === 0 ? `
      <p class="vacio">No hay usuarios.</p>
    ` : `
      <div class="gestion-usuarios">
        ${gestionUsuarios.map(u => `
          <div class="gestion-usuario ${!u.activo ? 'no-disponible' : ''}">
            <div class="gestion-usuario-info">
              <div class="gestion-usuario-nombre">
                ${esc(u.nombre)}
                <span class="rol-tag">${esc(u.rol)}</span>
                ${!u.activo ? '<span class="tag-no-disp">INACTIVO</span>' : ''}
              </div>
              <div class="gestion-usuario-email">${esc(u.email)}</div>
            </div>
            <div class="gestion-item-acciones">
              <button class="btn" data-editar-usuario="${u._id}">${icono('lapiz')} Editar</button>
              ${u._id !== usuario.userId
                ? `<button class="btn" data-reset-pass="${u._id}">${icono('llave')} Resetear pwd</button>`
                : ''}
            </div>
          </div>
        `).join('')}
      </div>
    `}
  `;
}

// ---------- Gestión: Config ----------
function renderGestionConfig() {
  if (!gestionConfig) return '<p class="vacio">Cargando…</p>';

  const c = gestionConfig.configuracion;

  return `
    <div class="gestion-header">
      <div>
        <h3>Configuración</h3>
        <p class="gestion-desc">Ajusta el comportamiento del sistema para tu restaurante.</p>
      </div>
    </div>

    <form id="form-config" class="form gestion-form">
      <div class="gestion-seccion">
        <h4>Datos generales</h4>
        <label>Nombre del restaurante
          <input name="nombre" required maxlength="80" value="${esc(gestionConfig.nombre)}" />
        </label>
        <label>Teléfono
          <input name="telefono" maxlength="30" value="${esc(gestionConfig.telefono)}" />
        </label>
      </div>

      <div class="gestion-seccion">
        <h4>Servicios activos</h4>
        <div class="gestion-checkbox-group">
          <label class="modal-checkbox">
            <input type="checkbox" name="srv_retiro" ${c.servicios.retiro ? 'checked' : ''}>
            <span class="modal-checkbox-label">Retiro en local</span>
          </label>
          <label class="modal-checkbox">
            <input type="checkbox" name="srv_delivery" ${c.servicios.delivery ? 'checked' : ''}>
            <span class="modal-checkbox-label">Delivery a domicilio</span>
          </label>
          <label class="modal-checkbox">
            <input type="checkbox" name="srv_dineIn" ${c.servicios.dineIn ? 'checked' : ''}>
            <span class="modal-checkbox-label">Consumo en mesa</span>
          </label>
        </div>
      </div>

      <div class="gestion-seccion">
        <h4>Comportamiento</h4>
        <label>Tiempo de espera (minutos)
          <input type="number" name="tiempoEspera" min="5" max="180" required value="${c.tiempoEspera}" />
        </label>
        <label class="modal-checkbox" style="border: none; padding: 0;">
          <input type="checkbox" name="aceptaMitades" ${c.aceptaMitades ? 'checked' : ''}>
          <span class="modal-checkbox-label">Aceptar pizzas por mitades</span>
        </label>
      </div>

      <div class="gestion-seccion">
        <h4>Delivery</h4>
        <label>Pedido mínimo para delivery ($)
          <input type="number" name="pedidoMinimo" min="0" step="1" value="${c.delivery.pedidoMinimo || 0}" />
        </label>

        <label>Zonas de delivery</label>
        <div id="zonas-lista" class="zonas-lista">
          ${(c.delivery.zonas || []).map((z, i) => `
            <div class="zona-item" data-zona-index="${i}">
              <input type="text" class="zona-nombre" placeholder="Nombre" value="${esc(z.nombre)}" />
              <input type="number" class="zona-costo" placeholder="Costo" min="0" step="1" value="${z.costo}" />
              <button type="button" class="btn-icono" data-eliminar-zona>${icono('equis')}</button>
            </div>
          `).join('')}
        </div>
        <button type="button" class="btn" id="btn-add-zona">${icono('mas')} Agregar zona</button>
      </div>

      <div class="gestion-seccion">
        <h4>Color de acento</h4>
        <p class="gestion-ayuda">Este color se aplica a botones, íconos, precios y elementos destacados del sistema.</p>
        <div class="gestion-colores">
          <label>Color
            <input type="color" name="colorAcento" value="${esc(c.colorAcento || '#ff4d00')}" />
          </label>
        </div>
      </div>

      <button type="submit" class="btn btn-primario btn-grande">${icono('guardar')} Guardar configuración</button>
    </form>
  `;
}

// ---------- Gestión: Mi cuenta ----------
function renderGestionMiCuenta() {
  return `
    <div class="gestion-header">
      <div>
        <h3>Mi cuenta</h3>
        <p class="gestion-desc">Cambia tu nombre, email o contraseña. Estos cambios son solo para tu usuario.</p>
      </div>
    </div>

    <form id="form-mi-cuenta" class="form gestion-form">
      <div class="gestion-seccion">
        <h4>Datos personales</h4>
        <label>Nombre
          <input name="nombre" required maxlength="80" value="${esc(usuario.nombre)}" />
        </label>
        <label>Email de inicio de sesión
          <input type="email" name="email" required maxlength="120" value="${esc(usuario.email || '')}" />
        </label>
        <p class="gestion-ayuda">
          El email es tu usuario para entrar al sistema. Si lo cambias, la próxima vez que inicies sesión deberás usar el nuevo.
        </p>
      </div>

      <div class="gestion-seccion">
        <h4>Cambiar contraseña</h4>
        <p class="gestion-ayuda">Deja estos campos vacíos si no quieres cambiar tu contraseña.</p>
        <label>Contraseña actual
          <input type="password" name="passwordActual" autocomplete="current-password" />
        </label>
        <label>Nueva contraseña (mínimo 8 caracteres)
          <input type="password" name="passwordNueva" minlength="8" autocomplete="new-password" />
        </label>
        <label>Confirmar nueva contraseña
          <input type="password" name="passwordNuevaConfirm" minlength="8" autocomplete="new-password" />
        </label>
      </div>

      <button type="submit" class="btn btn-primario btn-grande">${icono('guardar')} Guardar cambios</button>
    </form>
  `;
}

// ---------- Modal de gestión ----------
function abrirModalGestion(html) {
  const modal = document.getElementById('modal-gestion');
  if (!modal) return;
  modal.innerHTML = html;
  modal.classList.remove('oculto');
  document.body.style.overflow = 'hidden';
}

function cerrarModalGestion() {
  const modal = document.getElementById('modal-gestion');
  if (!modal) return;
  modal.classList.add('oculto');
  modal.innerHTML = '';
  document.body.style.overflow = '';
}

// Modal de platillo
function abrirModalPlatillo(item = null) {
  const esEdicion = !!item;
  const titulo = esEdicion ? 'Editar platillo' : 'Nuevo platillo';

  const it = item || {
    nombre: '',
    categoria: '',
    descripcion: '',
    imagen: null,
    precio: null,
    variantes: [],
    extras: [],
    opciones: [],
    disponible: true,
    orden: 1,
  };

  abrirModalGestion(`
    <div class="modal-overlay" data-cerrar-modal></div>
    <div class="modal-contenido modal-grande">
      <div class="modal-head">
        <h2>${titulo}</h2>
        <button class="btn-icono" data-cerrar-modal type="button">${icono('equis')}</button>
      </div>
      <div class="modal-body">
        <form id="form-platillo" class="form">
          <div class="form-grid-2">
            <label>Nombre *
              <input name="nombre" required maxlength="80" value="${esc(it.nombre)}" />
            </label>
            <label>Categoría *
              <input name="categoria" required maxlength="50" value="${esc(it.categoria)}" list="categorias-existentes" />
              <datalist id="categorias-existentes">
                ${gestionCategorias.map(c => `<option value="${esc(c)}">`).join('')}
              </datalist>
            </label>
          </div>

          <label>Descripción
            <textarea name="descripcion" rows="2" maxlength="300">${esc(it.descripcion)}</textarea>
          </label>

          <label>URL de la imagen (opcional)
            <input name="imagen" maxlength="500" placeholder="https://..." value="${esc(it.imagen || '')}" />
          </label>

          <div class="form-grid-2">
            <label>Precio (si no usas variantes)
              <input type="number" name="precio" min="0" step="0.01" value="${it.precio ?? ''}" />
            </label>
            <label>Orden
              <input type="number" name="orden" min="0" value="${it.orden || 1}" />
            </label>
          </div>

          <label class="modal-checkbox" style="border: none; padding: 0;">
            <input type="checkbox" name="disponible" ${it.disponible ? 'checked' : ''}>
            <span class="modal-checkbox-label">Disponible en el menú</span>
          </label>

          <div class="gestion-seccion">
            <div class="gestion-seccion-head">
              <h4>Variantes</h4>
              <button type="button" class="btn" data-add-variante>${icono('mas')} Agregar</button>
            </div>
            <p class="gestion-ayuda">Si agregas variantes (ej. Chica / Mediana / Grande), el precio base se ignora.</p>
            <div id="variantes-lista" class="dinamica-lista"></div>
          </div>

          <div class="gestion-seccion">
            <div class="gestion-seccion-head">
              <h4>Extras</h4>
              <button type="button" class="btn" data-add-extra>${icono('mas')} Agregar</button>
            </div>
            <p class="gestion-ayuda">Extras opcionales que el cliente puede añadir con costo adicional.</p>
            <div id="extras-lista" class="dinamica-lista"></div>
          </div>

          <div class="gestion-seccion">
            <div class="gestion-seccion-head">
              <h4>Opciones</h4>
              <button type="button" class="btn" data-add-opcion>${icono('mas')} Agregar</button>
            </div>
            <p class="gestion-ayuda">Opciones que el cliente debe elegir (tipo de tortilla, punto de la carne, etc.).</p>
            <div id="opciones-lista" class="dinamica-lista"></div>
          </div>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn" data-cerrar-modal type="button">Cancelar</button>
        <button class="btn btn-primario" id="btn-guardar-platillo" type="button">
          ${esEdicion ? 'Guardar cambios' : 'Crear platillo'}
        </button>
      </div>
    </div>
  `);

  const estado = {
    variantes: JSON.parse(JSON.stringify(it.variantes || [])),
    extras: JSON.parse(JSON.stringify(it.extras || [])),
    opciones: JSON.parse(JSON.stringify(it.opciones || [])),
  };

  const renderVariantes = () => {
    const el = document.getElementById('variantes-lista');
    if (!el) return;
    el.innerHTML = estado.variantes.length === 0
      ? '<p class="dinamica-vacio">Sin variantes. El platillo usará el precio base.</p>'
      : estado.variantes.map((v, i) => `
          <div class="dinamica-item">
            <input type="text" class="dyn-nombre" placeholder="Nombre (Chica)" value="${esc(v.nombre)}" data-idx="${i}" data-campo="nombre" />
            <input type="number" class="dyn-precio" placeholder="Precio" step="0.01" min="0" value="${v.precio}" data-idx="${i}" data-campo="precio" />
            <button type="button" class="btn-icono" data-eliminar-variante="${i}">${icono('equis')}</button>
          </div>
        `).join('');
  };

  const renderExtras = () => {
    const el = document.getElementById('extras-lista');
    if (!el) return;
    el.innerHTML = estado.extras.length === 0
      ? '<p class="dinamica-vacio">Sin extras.</p>'
      : estado.extras.map((e, i) => `
          <div class="dinamica-item">
            <input type="text" class="dyn-nombre" placeholder="Nombre" value="${esc(e.nombre)}" data-idx="${i}" data-campo="nombre" data-tipo="extra" />
            <input type="number" class="dyn-precio" placeholder="Precio" step="0.01" min="0" value="${e.precio}" data-idx="${i}" data-campo="precio" data-tipo="extra" />
            <input type="number" class="dyn-max" placeholder="Máx" min="1" max="10" value="${e.max || 1}" data-idx="${i}" data-campo="max" data-tipo="extra" title="Cantidad máxima" />
            <button type="button" class="btn-icono" data-eliminar-extra="${i}">${icono('equis')}</button>
          </div>
        `).join('');
  };

  const renderOpciones = () => {
    const el = document.getElementById('opciones-lista');
    if (!el) return;
    el.innerHTML = estado.opciones.length === 0
      ? '<p class="dinamica-vacio">Sin opciones.</p>'
      : estado.opciones.map((o, i) => `
          <div class="dinamica-item-opcion">
            <div class="dinamica-item-opcion-head">
              <input type="text" class="dyn-nombre" placeholder="Título (Tipo de tortilla)" value="${esc(o.nombre)}" data-idx="${i}" data-campo="nombre" data-tipo="opcion" />
              <select class="dyn-tipo" data-idx="${i}" data-campo="tipo">
                <option value="radio" ${o.tipo === 'radio' ? 'selected' : ''}>Elegir uno</option>
                <option value="checkbox" ${o.tipo === 'checkbox' ? 'selected' : ''}>Sí/No</option>
              </select>
              <label class="dyn-req">
                <input type="checkbox" ${o.requerido ? 'checked' : ''} data-idx="${i}" data-campo="requerido" data-tipo="opcion" />
                <span>Oblig.</span>
              </label>
              <button type="button" class="btn-icono" data-eliminar-opcion="${i}">${icono('equis')}</button>
            </div>
            ${o.tipo === 'radio' ? `
              <div class="dinamica-valores">
                <p class="gestion-ayuda">Valores posibles:</p>
                ${(o.valores || []).map((v, j) => `
                  <div class="dinamica-item">
                    <input type="text" class="dyn-valor-nombre" placeholder="Nombre" value="${esc(v.nombre)}" data-opidx="${i}" data-validx="${j}" />
                    <input type="number" class="dyn-valor-precio" placeholder="Extra $" step="0.01" min="0" value="${v.precio || 0}" data-opidx="${i}" data-validx="${j}" />
                    <button type="button" class="btn-icono" data-eliminar-valor="${i}|${j}">${icono('equis')}</button>
                  </div>
                `).join('')}
                <button type="button" class="btn" data-add-valor="${i}">${icono('mas')} Agregar valor</button>
              </div>
            ` : ''}
          </div>
        `).join('');
  };

  const modal = document.getElementById('modal-gestion');
  modal.onclick = (e) => {
    if (e.target.closest('[data-cerrar-modal]')) { cerrarModalGestion(); return; }

    if (e.target.closest('[data-add-variante]')) {
      estado.variantes.push({ id: 'v' + Date.now().toString(36), nombre: '', precio: 0 });
      renderVariantes();
      return;
    }
    const delVar = e.target.closest('[data-eliminar-variante]');
    if (delVar) {
      estado.variantes.splice(+delVar.dataset.eliminarVariante, 1);
      renderVariantes();
      return;
    }

    if (e.target.closest('[data-add-extra]')) {
      estado.extras.push({ id: 'e' + Date.now().toString(36), nombre: '', precio: 0, max: 1 });
      renderExtras();
      return;
    }
    const delExt = e.target.closest('[data-eliminar-extra]');
    if (delExt) {
      estado.extras.splice(+delExt.dataset.eliminarExtra, 1);
      renderExtras();
      return;
    }

    if (e.target.closest('[data-add-opcion]')) {
      estado.opciones.push({ id: 'o' + Date.now().toString(36), nombre: '', tipo: 'radio', requerido: false, valores: [] });
      renderOpciones();
      return;
    }
    const delOpc = e.target.closest('[data-eliminar-opcion]');
    if (delOpc) {
      estado.opciones.splice(+delOpc.dataset.eliminarOpcion, 1);
      renderOpciones();
      return;
    }
    const addVal = e.target.closest('[data-add-valor]');
    if (addVal) {
      const idx = +addVal.dataset.addValor;
      if (!estado.opciones[idx].valores) estado.opciones[idx].valores = [];
      estado.opciones[idx].valores.push({ id: 'val' + Date.now().toString(36), nombre: '', precio: 0 });
      renderOpciones();
      return;
    }
    const delVal = e.target.closest('[data-eliminar-valor]');
    if (delVal) {
      const [i, j] = delVal.dataset.eliminarValor.split('|').map(Number);
      estado.opciones[i].valores.splice(j, 1);
      renderOpciones();
      return;
    }

    if (e.target.closest('#btn-guardar-platillo')) {
      guardarPlatillo(item?._id || null, estado);
    }
  };

  modal.addEventListener('input', (e) => {
    const t = e.target;
    const idx = +t.dataset.idx;
    const campo = t.dataset.campo;
    if (isNaN(idx) || !campo) return;

    let valor = t.type === 'checkbox' ? t.checked : t.value;
    if (t.type === 'number') valor = parseFloat(valor) || 0;

    if (t.dataset.tipo === 'extra') {
      estado.extras[idx][campo] = valor;
    } else if (t.dataset.tipo === 'opcion') {
      estado.opciones[idx][campo] = valor;
      if (campo === 'tipo') renderOpciones();
    } else if (t.classList.contains('dyn-valor-nombre') || t.classList.contains('dyn-valor-precio')) {
      const oi = +t.dataset.opidx;
      const vi = +t.dataset.validx;
      const val = t.type === 'number' ? parseFloat(valor) || 0 : valor;
      if (t.classList.contains('dyn-valor-nombre')) estado.opciones[oi].valores[vi].nombre = val;
      else estado.opciones[oi].valores[vi].precio = val;
    } else {
      estado.variantes[idx][campo] = valor;
    }
  });

  renderVariantes();
  renderExtras();
  renderOpciones();
}

async function guardarPlatillo(id, estado) {
  const form = document.getElementById('form-platillo');
  if (!form.checkValidity()) { form.reportValidity(); return; }

  const nombre = form.nombre.value.trim();
  const categoria = form.categoria.value.trim();
  const descripcion = form.descripcion.value.trim();
  const imagen = form.imagen.value.trim() || null;
  const precioRaw = form.precio.value;
  const precio = precioRaw === '' ? null : parseFloat(precioRaw);
  const orden = parseInt(form.orden.value, 10) || 1;
  const disponible = form.disponible.checked;

  const variantes = estado.variantes
    .filter(v => v.nombre && v.precio)
    .map(v => ({
      id: v.id || 'v' + Math.random().toString(36).slice(2, 8),
      nombre: v.nombre,
      precio: +Number(v.precio).toFixed(2),
    }));

  const extras = estado.extras
    .filter(e => e.nombre)
    .map(e => ({
      id: e.id || 'e' + Math.random().toString(36).slice(2, 8),
      nombre: e.nombre,
      precio: +Number(e.precio || 0).toFixed(2),
      max: Math.max(1, Math.min(10, parseInt(e.max, 10) || 1)),
    }));

  const opciones = estado.opciones
    .filter(o => o.nombre)
    .map(o => ({
      id: o.id || 'o' + Math.random().toString(36).slice(2, 8),
      nombre: o.nombre,
      tipo: o.tipo,
      requerido: !!o.requerido,
      valores: (o.valores || [])
        .filter(v => v.nombre)
        .map(v => ({
          id: v.id || 'val' + Math.random().toString(36).slice(2, 8),
          nombre: v.nombre,
          precio: +Number(v.precio || 0).toFixed(2),
        })),
    }));

  const payload = {
    nombre,
    categoria,
    descripcion,
    imagen,
    precio: variantes.length > 0 ? null : precio,
    variantes,
    extras,
    opciones,
    disponible,
    orden,
  };

  const url = id ? `/api/${SLUG}/gestion/menu/${id}` : `/api/${SLUG}/gestion/menu`;
  const method = id ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');

    cerrarModalGestion();
    await cargarGestion(true);
    render();
  } catch (err) {
    alert(err.message);
  }
}

function abrirModalUsuario(u = null) {
  const esEdicion = !!u;
  const usr = u || { nombre: '', email: '', rol: 'cocina', activo: true };

  abrirModalGestion(`
    <div class="modal-overlay" data-cerrar-modal></div>
    <div class="modal-contenido">
      <div class="modal-head">
        <h2>${esEdicion ? 'Editar usuario' : 'Nuevo usuario'}</h2>
        <button class="btn-icono" data-cerrar-modal type="button">${icono('equis')}</button>
      </div>
      <div class="modal-body">
        <form id="form-usuario" class="form">
          <label>Nombre
            <input name="nombre" required maxlength="80" value="${esc(usr.nombre)}" />
          </label>
          <label>Email
            <input type="email" name="email" required ${esEdicion ? 'disabled' : ''} value="${esc(usr.email)}" />
          </label>
          <label>Rol
            <select name="rol">
              <option value="cocina" ${usr.rol === 'cocina' ? 'selected' : ''}>Cocina</option>
              <option value="caja" ${usr.rol === 'caja' ? 'selected' : ''}>Caja</option>
              <option value="mesero" ${usr.rol === 'mesero' ? 'selected' : ''}>Mesero</option>
              <option value="owner" ${usr.rol === 'owner' ? 'selected' : ''}>Owner</option>
            </select>
          </label>
          ${esEdicion ? `
            <label class="modal-checkbox" style="border: none; padding: 0;">
              <input type="checkbox" name="activo" ${usr.activo ? 'checked' : ''}>
              <span class="modal-checkbox-label">Usuario activo</span>
            </label>
          ` : ''}
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn" data-cerrar-modal type="button">Cancelar</button>
        <button class="btn btn-primario" id="btn-guardar-usuario" type="button">
          ${esEdicion ? 'Guardar' : 'Crear usuario'}
        </button>
      </div>
    </div>
  `);

  const modal = document.getElementById('modal-gestion');
  modal.onclick = (e) => {
    if (e.target.closest('[data-cerrar-modal]')) { cerrarModalGestion(); return; }
    if (e.target.closest('#btn-guardar-usuario')) {
      guardarUsuario(usr._id || null);
    }
  };
}

async function guardarUsuario(id) {
  const form = document.getElementById('form-usuario');
  if (!form.checkValidity()) { form.reportValidity(); return; }

  const payload = {
    nombre: form.nombre.value.trim(),
    rol: form.rol.value,
  };

  if (!id) {
    payload.email = form.email.value.trim().toLowerCase();
  } else {
    payload.activo = form.activo.checked;
  }

  const url = id ? `/api/${SLUG}/gestion/usuarios/${id}` : `/api/${SLUG}/gestion/usuarios`;
  const method = id ? 'PUT' : 'POST';

  try {
    const res = await fetch(url, {
      method,
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');

    cerrarModalGestion();

    if (!id && data.passwordTemporal) {
      alert(`Usuario creado\n\nNombre: ${data.usuario.nombre}\nEmail: ${data.usuario.email}\nRol: ${data.usuario.rol}\n\nContraseña temporal: ${data.passwordTemporal}\n\nCópiala y envíasela al empleado. Se le pedirá cambiarla al entrar.`);
    }

    await cargarGestion(true);
    render();
  } catch (err) {
    alert(err.message);
  }
}

async function resetearPasswordUsuario(id) {
  const u = gestionUsuarios.find(x => x._id === id);
  if (!u) return;
  if (!await confirmar(`¿Resetear la contraseña de ${u.nombre}? Se generará una temporal nueva.`, { titulo: 'Resetear contraseña', textoAceptar: 'Resetear' })) return;

  try {
    const res = await fetch(`/api/${SLUG}/gestion/usuarios/${id}/reset-password`, {
      method: 'POST',
      credentials: 'include',
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error');

    alert(`Contraseña reseteada\n\nUsuario: ${data.nombre}\nEmail: ${data.email}\n\nNueva contraseña temporal: ${data.passwordTemporal}\n\nEnvíasela por WhatsApp. Se le pedirá cambiarla al entrar.`);
  } catch (err) {
    alert(err.message);
  }
}

// ---------- Preview en vivo del color de acento ----------
document.addEventListener('input', (e) => {
  if (!e.target.matches('#form-config input[name="colorAcento"]')) return;
  const c = e.target.value;
  const root = document.documentElement;
  root.style.setProperty('--acento', c);
  root.style.setProperty('--acento-hover', oscurecerHex(c, 20));
  root.style.setProperty('--acento-suave', hexARgba(c, 0.08));
});

// ---------- Eventos globales ----------
async function onGlobalClick(e) {
  if (e.target.closest('[data-cerrar-modal]')) {
    cerrarModalCuenta();
    cerrarModalGestion();
    return;
  }

  const tab = e.target.closest('[data-vista]');
  if (tab) {
    vistaActiva = tab.dataset.vista;
    if (vistaActiva === 'gestion') {
      cargarGestion().then(() => render());
    } else {
      render();
    }
    return;
  }

  const subtab = e.target.closest('[data-gestion]');
  if (subtab) {
    vistaGestion = subtab.dataset.gestion;
    render();
    return;
  }

  const chipServicio = e.target.closest('[data-servicio-filtro]');
  if (chipServicio) { filtroServicio = chipServicio.dataset.servicioFiltro; render(); return; }

  const chipEstado = e.target.closest('[data-filtro]');
  if (chipEstado) { filtroEstado = chipEstado.dataset.filtro; render(); return; }

  const btnTicket = e.target.closest('[data-ticket]');
  if (btnTicket) {
    window.open(`/${SLUG}/ticket/${btnTicket.dataset.ticket}`, '_blank', 'width=500,height=800');
    return;
  }
  const btnTicketMesa = e.target.closest('[data-ticket-mesa]');
  if (btnTicketMesa) {
    window.open(`/${SLUG}/ticket-mesa/${btnTicketMesa.dataset.ticketMesa}`, '_blank', 'width=500,height=800');
    return;
  }

  const btnAvanzar = e.target.closest('[data-avanzar]');
  if (btnAvanzar) {
    const p = pedidos.find(x => x.id === btnAvanzar.dataset.avanzar);
    if (p) {
      const siguiente = estadoSiguiente(p.estado);
      if (siguiente) cambiarEstado(p.id, siguiente);
    }
    return;
  }

  const btnCancelar = e.target.closest('[data-cancelar]');
  if (btnCancelar) {
    const esCaja = ROL === 'caja';
    const razon = await pedir(
      esCaja ? 'Indica la razón de la cancelación' : '¿Por qué cancelas este pedido?',
      '',
      {
        titulo: 'Cancelar pedido',
        label: esCaja ? 'Razón (obligatoria)' : 'Razón (opcional)',
        placeholder: 'Ej: cliente cambió de opinión',
        required: esCaja,
        textoAceptar: 'Continuar',
      }
    );
    if (razon === null) return;

    if (await confirmar('¿Confirmas la cancelación de este pedido?', { titulo: 'Cancelar pedido', tipo: 'peligro', textoAceptar: 'Sí, cancelar' })) {
      cambiarEstado(btnCancelar.dataset.cancelar, 'cancelado', razon);
    }
    return;
  }

  const btnVerMesa = e.target.closest('[data-ver-mesa]');
  if (btnVerMesa) { abrirModalCuenta(parseInt(btnVerMesa.dataset.verMesa, 10)); return; }
  const btnCerrarMesa = e.target.closest('[data-cerrar-mesa]');
  if (btnCerrarMesa) { cerrarCuentaMesa(parseInt(btnCerrarMesa.dataset.cerrarMesa, 10)); return; }

  const btnNuevoPlatillo = e.target.closest('[data-nuevo-platillo]');
  if (btnNuevoPlatillo) { abrirModalPlatillo(null); return; }

  const btnEditarPlatillo = e.target.closest('[data-editar-platillo]');
  if (btnEditarPlatillo) {
    const item = gestionMenu.find(x => x._id === btnEditarPlatillo.dataset.editarPlatillo);
    if (item) abrirModalPlatillo(item);
    return;
  }

  const btnEliminarPlatillo = e.target.closest('[data-eliminar-platillo]');
  if (btnEliminarPlatillo) {
    const item = gestionMenu.find(x => x._id === btnEliminarPlatillo.dataset.eliminarPlatillo);
    if (item && await confirmar(`¿Eliminar "${item.nombre}" del menú?`, { titulo: 'Eliminar platillo', tipo: 'peligro', textoAceptar: 'Eliminar' })) {
      eliminarPlatillo(item._id);
    }
    return;
  }

  const btnNuevoUsuario = e.target.closest('[data-nuevo-usuario]');
  if (btnNuevoUsuario) { abrirModalUsuario(null); return; }

  const btnEditarUsuario = e.target.closest('[data-editar-usuario]');
  if (btnEditarUsuario) {
    const u = gestionUsuarios.find(x => x._id === btnEditarUsuario.dataset.editarUsuario);
    if (u) abrirModalUsuario(u);
    return;
  }

  const btnResetPass = e.target.closest('[data-reset-pass]');
  if (btnResetPass) { resetearPasswordUsuario(btnResetPass.dataset.resetPass); return; }

  const btnAddZona = e.target.closest('#btn-add-zona');
  if (btnAddZona) {
    const lista = document.getElementById('zonas-lista');
    const nuevoIdx = lista.children.length;
    const div = document.createElement('div');
    div.className = 'zona-item';
    div.dataset.zonaIndex = nuevoIdx;
    div.innerHTML = `
      <input type="text" class="zona-nombre" placeholder="Nombre" value="" />
      <input type="number" class="zona-costo" placeholder="Costo" min="0" step="1" value="0" />
      <button type="button" class="btn-icono" data-eliminar-zona>${icono('equis')}</button>
    `;
    lista.appendChild(div);
    return;
  }

  const btnElimZona = e.target.closest('[data-eliminar-zona]');
  if (btnElimZona) {
    btnElimZona.closest('.zona-item').remove();
    return;
  }
}

async function eliminarPlatillo(id) {
  try {
    const res = await fetch(`/api/${SLUG}/gestion/menu/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) throw new Error('Error al eliminar');
    await cargarGestion(true);
    render();
  } catch (err) {
    alert(err.message);
  }
}

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'form-config') return;
  e.preventDefault();

  const f = e.target;
  const zonas = [];
  f.querySelectorAll('.zona-item').forEach(z => {
    const nombre = z.querySelector('.zona-nombre').value.trim();
    const costo = parseFloat(z.querySelector('.zona-costo').value) || 0;
    if (nombre) {
      zonas.push({
        id: 'z' + Math.random().toString(36).slice(2, 8),
        nombre,
        costo,
      });
    }
  });

  const payload = {
    nombre: f.nombre.value.trim(),
    telefono: f.telefono.value.trim(),
    configuracion: {
      servicios: {
        retiro: f.srv_retiro.checked,
        delivery: f.srv_delivery.checked,
        dineIn: f.srv_dineIn.checked,
      },
      tiempoEspera: parseInt(f.tiempoEspera.value, 10) || 30,
      aceptaMitades: f.aceptaMitades.checked,
      colorAcento: f.colorAcento.value,
      delivery: {
        pedidoMinimo: parseFloat(f.pedidoMinimo.value) || 0,
        zonas,
      },
    },
  };

  try {
    const res = await fetch(`/api/${SLUG}/gestion/config`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');

    await cargarConfig();
    aplicarColoresDelTenant(CONFIG.configuracion);
    gestionCargada = false;
    await cargarGestion(true);
    render();
  } catch (err) {
    alert(err.message);
  }
});

document.addEventListener('submit', async (e) => {
  if (e.target.id !== 'form-mi-cuenta') return;
  e.preventDefault();

  const f = e.target;
  const nombre = f.nombre.value.trim();
  const email = f.email.value.trim().toLowerCase();
  const passwordActual = f.passwordActual.value;
  const passwordNueva = f.passwordNueva.value;
  const passwordNuevaConfirm = f.passwordNuevaConfirm.value;

  if (passwordNueva || passwordNuevaConfirm) {
    if (passwordNueva !== passwordNuevaConfirm) {
      alert('Las nuevas contraseñas no coinciden');
      return;
    }
    if (passwordNueva.length < 8) {
      alert('La nueva contraseña debe tener al menos 8 caracteres');
      return;
    }
    if (!passwordActual) {
      alert('Debes ingresar tu contraseña actual para cambiarla');
      return;
    }
  }

  const payload = { nombre, email };
  if (passwordNueva) {
    payload.passwordActual = passwordActual;
    payload.passwordNueva = passwordNueva;
  }

  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Guardando…';

  try {
    const res = await fetch(`/api/${SLUG}/gestion/mi-cuenta`, {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al guardar');

    if (data.usuario) {
      usuario.nombre = data.usuario.nombre;
      usuario.email = data.usuario.email;
    }

    const badgeNombre = document.querySelector('.rol-badge');
    if (badgeNombre) badgeNombre.textContent = usuario.nombre;

    f.passwordActual.value = '';
    f.passwordNueva.value = '';
    f.passwordNuevaConfirm.value = '';

    let mensaje = 'Cambios guardados.';
    if (data.cambioEmail) {
      mensaje = 'Cambios guardados.\n\nTu email de inicio de sesión cambió a: ' + usuario.email + '\n\nLa próxima vez que entres, usa este email.';
    } else if (passwordNueva) {
      mensaje = 'Contraseña actualizada correctamente.';
    }
    alert(mensaje);

    btn.disabled = false;
    btn.innerHTML = `${icono('guardar')} Guardar cambios`;
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
    btn.innerHTML = `${icono('guardar')} Guardar cambios`;
  }
});

async function cambiarEstado(id, estado, razonCancelacion = null) {
  const body = { estado };
  if (razonCancelacion) body.razonCancelacion = razonCancelacion;

  const res = await fetch(`/api/${SLUG}/pedidos/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (res.ok) {
    cargarTodo();
  } else {
    const data = await res.json().catch(() => ({}));
    alert(data.error || 'Error al cambiar estado');
  }
}

// ---------- Arranque ----------
chequearSesion();