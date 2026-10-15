// ============================================================
// HERMES · Panel de control interno
// ============================================================

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const API = '/api/rubedo';

let tenants = [];

// ---------- Login ----------
function mostrarLogin() {
  document.body.innerHTML = `
    <div class="login-wrap">
      <div class="login-lado">
        <div class="marca">
          <img class="logo-marca" src="/logo.svg" alt="" aria-hidden="true">
          <span>Hermes</span>
        </div>
        <h1>Acceso<br>restringido.</h1>
        <p class="pie">Sistema interno</p>
      </div>
      <div class="login-form-wrap">
        <form class="login-card" id="form-login">
          <h2>Iniciar sesión</h2>
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

  document.getElementById('form-login').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const btn = f.querySelector('button[type=submit]');
    const err = document.getElementById('login-error');
    err.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Entrando…';

    try {
      const res = await fetch(`${API}/login`, {
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
      window.location.reload();
    } catch (ex) {
      err.textContent = ex.message;
      btn.disabled = false;
      btn.textContent = 'Entrar';
    }
  };
}

// ---------- Panel principal ----------
async function arrancarPanel() {
  document.body.innerHTML = `
    <header class="topbar">
      <div class="marca">
        <img class="logo-marca" src="/logo.svg" alt="" aria-hidden="true">
        <span>Panel</span>
      </div>
      <div class="acciones">
        <button id="btn-backup" class="btn">Backup</button>
        <button id="btn-nuevo" class="btn btn-primario">+ Nuevo restaurante</button>
        <button id="btn-refrescar" class="btn">Actualizar</button>
        <button id="btn-salir" class="btn">Salir</button>
      </div>
    </header>
    <main class="contenedor">
      <div id="contenido"></div>
    </main>
    <div id="modal-superadmin" class="modal oculto"></div>
  `;

  document.getElementById('btn-backup').onclick = async () => {
    if (!await confirmar('¿Descargar un backup completo de la base de datos?\n\nPuede pesar varios MB según el volumen de datos.', { titulo: 'Descargar backup', textoAceptar: 'Descargar' })) return;
    window.open('/api/rubedo/backup', '_blank');
  };
  document.getElementById('btn-refrescar').onclick = cargarTenants;
  document.getElementById('btn-nuevo').onclick = abrirModalNuevo;
  document.getElementById('btn-salir').onclick = async () => {
    await fetch(`${API}/logout`, { method: 'POST', credentials: 'include' });
    window.location.reload();
  };

  document.addEventListener('click', onGlobalClick);

  

  await cargarTenants();
}

async function cargarTenants() {
  try {
    const res = await fetch(`${API}/tenants`, { credentials: 'include' });
    if (res.status === 401) { mostrarLogin(); return; }
    if (!res.ok) return;
    tenants = await res.json();
    render();
  } catch (e) {
    console.error(e);
  }
}

function render() {
  const el = document.getElementById('contenido');
  if (!el) return;

  const totalTenants = tenants.length;
  const activos = tenants.filter(t => t.activo).length;
  const totalPedidos = tenants.reduce((s, t) => s + (t.metricas?.totalPedidos || 0), 0);

  el.innerHTML = `
    <div class="metricas-grid">
      <div class="metrica">
        <span class="metrica-label">Restaurantes</span>
        <strong class="metrica-valor">${totalTenants}</strong>
      </div>
      <div class="metrica">
        <span class="metrica-label">Activos</span>
        <strong class="metrica-valor">${activos}</strong>
      </div>
      <div class="metrica">
        <span class="metrica-label">Pedidos totales</span>
        <strong class="metrica-valor">${totalPedidos}</strong>
      </div>
    </div>

    <div class="tenants-lista">
      ${tenants.map(t => tarjetaTenant(t)).join('')}
    </div>
  `;
}

function tarjetaTenant(t) {
  const m = t.metricas || {};
  return `
    <article class="tenant-card ${t.activo ? 'activo' : 'inactivo'}">
      <header>
        <div>
          <strong class="tenant-nombre">${esc(t.nombre)}</strong>
          <span class="tenant-slug">/${esc(t.slug)}</span>
        </div>
        <span class="tenant-estado">${t.activo ? 'Activo' : 'Suspendido'}</span>
      </header>
      <div class="tenant-metricas">
        <div><span>Pedidos</span><strong>${m.totalPedidos || 0}</strong></div>
        <div><span>Este mes</span><strong>${m.pedidosMes || 0}</strong></div>
        <div><span>Usuarios</span><strong>${m.usuarios || 0}</strong></div>
        <div><span>Plan</span><strong>${esc(t.plan || 'free')}</strong></div>
      </div>
      <footer>
        <button class="btn" data-ver="${t._id}">Ver</button>
        <button class="btn" data-impersonar="${t._id}">Impersonar</button>
        <button class="btn ${t.activo ? 'btn-peligro' : 'btn-primario'}" data-toggle="${t._id}">
          ${t.activo ? 'Suspender' : 'Activar'}
        </button>
      </footer>
    </article>
  `;
}

// ---------- Modal nuevo tenant ----------
function abrirModalNuevo() {
  const modal = document.getElementById('modal-superadmin');
  if (!modal) return;

  modal.innerHTML = `
    <div class="modal-overlay" data-cerrar-modal></div>
    <div class="modal-contenido">
      <div class="modal-head">
        <h2>Nuevo restaurante</h2>
        <button class="btn-icono" data-cerrar-modal type="button">✕</button>
      </div>
      <div class="modal-body">
        <form id="form-nuevo" class="form">
          <label>Nombre del restaurante
            <input name="nombre" required maxlength="80" placeholder="Pizzería Bella" />
          </label>
          <label>Slug (URL)
            <input name="slug" required maxlength="30" pattern="[a-z0-9-]+" placeholder="pizzeria-bella" />
          </label>
          <label>Tipo
            <select name="tipo">
              <option value="pizzeria">Pizzería</option>
              <option value="taqueria">Taquería</option>
              <option value="cafeteria">Cafetería</option>
              <option value="otro">Otro</option>
            </select>
          </label>
          <label>Preset
            <select name="preset">
              <option value="pizzeria">Pizzería (10 mesas, mitades)</option>
              <option value="taqueria">Taquería (12 mesas)</option>
              <option value="cafeteria">Cafetería (8 mesas)</option>
            </select>
          </label>
          <label>Email del owner
            <input type="email" name="emailOwner" required placeholder="owner@restaurante.com" />
          </label>
          <label>Teléfono
            <input name="telefono" maxlength="30" placeholder="4771234567" />
          </label>
        </form>
      </div>
      <div class="modal-footer">
        <button class="btn" data-cerrar-modal type="button">Cancelar</button>
        <button class="btn btn-primario" id="btn-crear" type="button">Crear restaurante</button>
      </div>
    </div>
  `;

  modal.classList.remove('oculto');
  document.body.style.overflow = 'hidden';

  document.getElementById('btn-crear').onclick = async () => {
    const f = document.getElementById('form-nuevo');
    if (!f.checkValidity()) {
      f.reportValidity();
      return;
    }

    const btn = document.getElementById('btn-crear');
    btn.disabled = true;
    btn.textContent = 'Creando…';

    try {
      const res = await fetch(`${API}/tenants`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nombre: f.nombre.value.trim(),
          slug: f.slug.value.trim().toLowerCase(),
          tipo: f.tipo.value,
          preset: f.preset.value,
          emailOwner: f.emailOwner.value.trim(),
          telefono: f.telefono.value.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al crear');

      cerrarModal();
      await cargarTenants();

      alert(`✅ Restaurante creado\n\nURL: /${data.tenant.slug}\nOwner: ${data.ownerEmail}\nContraseña temporal: ${data.passwordTemporal}\n\n⚠️ Cópiala y envíasela al dueño. No se volverá a mostrar.`);
    } catch (err) {
      alert(err.message);
      btn.disabled = false;
      btn.textContent = 'Crear restaurante';
    }
  };
}

function cerrarModal() {
  const modal = document.getElementById('modal-superadmin');
  if (!modal) return;
  modal.classList.add('oculto');
  modal.innerHTML = '';
  document.body.style.overflow = '';
}

// ---------- Eventos ----------
async function onGlobalClick(e) {
  if (e.target.closest('[data-cerrar-modal]')) {
    cerrarModal();
    return;
  }

  const btnVer = e.target.closest('[data-ver]');
  if (btnVer) {
    verTenant(btnVer.dataset.ver);
    return;
  }

  const btnToggle = e.target.closest('[data-toggle]');
  if (btnToggle) {
    const t = tenants.find(x => x._id === btnToggle.dataset.toggle);
    if (!t) return;
    const accion = t.activo ? 'suspender' : 'activar';
    if (!await confirmar(`¿${accion.charAt(0).toUpperCase() + accion.slice(1)} "${t.nombre}"?`, { titulo: 'Cambiar estado', tipo: t.activo ? 'peligro' : 'info', textoAceptar: 'Continuar' })) return;
    toggleTenant(t._id, !t.activo);
    return;
  }

  const btnImpersonar = e.target.closest('[data-impersonar]');
  if (btnImpersonar) {
    impersonarTenant(btnImpersonar.dataset.impersonar);
    return;
  }
}

async function verTenant(id) {
  try {
    const res = await fetch(`${API}/tenants/${id}`, { credentials: 'include' });
    if (!res.ok) return;
    const data = await res.json();

    const modal = document.getElementById('modal-superadmin');
    modal.innerHTML = `
      <div class="modal-overlay" data-cerrar-modal></div>
      <div class="modal-contenido">
        <div class="modal-head">
          <h2>${esc(data.tenant.nombre)}</h2>
          <button class="btn-icono" data-cerrar-modal type="button">✕</button>
        </div>
        <div class="modal-body">
          <div class="tenant-detalle">
            <p><strong>URL:</strong> /${esc(data.tenant.slug)}</p>
            <p><strong>Tipo:</strong> ${esc(data.tenant.tipo)}</p>
            <p><strong>Email:</strong> ${esc(data.tenant.email)}</p>
            <p><strong>Teléfono:</strong> ${esc(data.tenant.telefono || '—')}</p>
            <p><strong>Plan:</strong> ${esc(data.tenant.plan)}</p>
            <p><strong>Estado:</strong> ${data.tenant.activo ? 'Activo' : 'Suspendido'}</p>
            <p><strong>Pedidos totales:</strong> ${data.metricas.totalPedidos}</p>
            <p><strong>Pedidos este mes:</strong> ${data.metricas.pedidosMes}</p>
          </div>

          <h3 style="margin-top: 20px; font-size: 0.9rem;">Usuarios (${data.usuarios.length})</h3>
          <ul class="usuarios-lista">
            ${data.usuarios.map(u => `
              <li>
                <strong>${esc(u.nombre)}</strong>
                <span>${esc(u.email)}</span>
                <span class="rol-tag">${esc(u.rol)}</span>
              </li>
            `).join('')}
          </ul>

          <h3 style="margin-top: 20px; font-size: 0.9rem;">Resetear contraseña</h3>
          <p style="font-size: 0.85rem; margin-bottom: 10px;">Si el owner olvidó su contraseña, genera una temporal nueva.</p>
          <button class="btn btn-peligro" id="btn-reset">Resetear contraseña del owner</button>
        </div>
        <div class="modal-footer">
          <button class="btn" data-cerrar-modal type="button">Cerrar</button>
        </div>
      </div>
    `;
    modal.classList.remove('oculto');
    document.body.style.overflow = 'hidden';

    document.getElementById('btn-reset').onclick = async () => {
      if (!await confirmar('¿Resetear la contraseña del owner? Se generará una nueva temporal.', { titulo: 'Resetear contraseña', textoAceptar: 'Resetear' })) return;
      const owner = data.usuarios.find(u => u.rol === 'owner');
      if (!owner) return alert('No se encontró owner');

      const res = await fetch(`${API}/tenants/${id}/reset-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emailOwner: owner.email }),
      });
      const r = await res.json();
      if (res.ok) {
        alert(`Nueva contraseña temporal:\n\n${r.passwordTemporal}\n\nEnvíasela al owner. Se le pedirá cambiarla al entrar.`);
      } else {
        alert(r.error || 'Error');
      }
    };
  } catch (e) {
    console.error(e);
  }
}

async function toggleTenant(id, activo) {
  const res = await fetch(`${API}/tenants/${id}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ activo }),
  });
  if (res.ok) cargarTenants();
}

async function impersonarTenant(id) {
  if (!await confirmar('¿Entrar como el owner de este restaurante?\n\nSerás redirigido al panel del restaurante.', { titulo: 'Impersonar usuario', textoAceptar: 'Entrar' })) return;
  const res = await fetch(`${API}/tenants/${id}/impersonar`, {
    method: 'POST',
    credentials: 'include',
  });
  const data = await res.json();
  if (res.ok) {
    window.location.href = `/${data.tenantSlug}/admin`;
  } else {
    alert(data.error || 'Error');
  }
}

// ---------- Arranque ----------
(async function init() {
  try {
    const res = await fetch(`${API}/me`, { credentials: 'include' });
    if (res.ok) {
      arrancarPanel();
    } else {
      mostrarLogin();
    }
  } catch {
    mostrarLogin();
  }
})();