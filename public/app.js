// ============================================================
// HERMES · Cliente
// ============================================================

// ---------- Helpers ----------
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);
const esc = s => String(s).replace(/[&<>"']/g,
  c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const formato = n => '$' + Number(n || 0).toFixed(2);

// ---------- Detección de contexto ----------
const contexto = (() => {
  const match = window.location.pathname.match(/^\/([a-z0-9-]+)(?:\/mesa\/(\d+))?/i);
  if (!match) return null;
  const params = new URLSearchParams(window.location.search);
  return {
    slug: match[1].toLowerCase(),
    mesaNumero: match[2] ? parseInt(match[2], 10) : null,
    mesaToken: params.get('t') || null,
  };
})();

if (!contexto) {
  document.body.innerHTML = '<p style="padding:40px">Falta el identificador del restaurante en la URL.</p>';
  throw new Error('Sin slug');
}

const SLUG = contexto.slug;
const IVA_RATE = 0.16;
const MESA_ACCESO_VALIDO = !!(contexto.mesaNumero && contexto.mesaToken);

// ---------- Estado ----------
let CONFIG = {
  slug: SLUG,
  nombre: 'Restaurante',
  tipo: 'otro',
  configuracion: {
    servicios: { retiro: true, delivery: false, dineIn: false },
    estados: [
      { id: 'pendiente', label: 'Pendiente', siguiente: 'preparando' },
      { id: 'preparando', label: 'Preparando', siguiente: 'listo' },
      { id: 'listo', label: 'Listo', siguiente: 'entregado' },
      { id: 'entregado', label: 'Entregado', siguiente: null },
    ],
    tiempoEspera: 30,
    aceptaMitades: false,
    delivery: { pedidoMinimo: 0, zonas: [] },
  },
};

let MENU = [];
let carrito = {};
let pedidoActual = null;
let intervalo = null;

let tipoServicioSel = 'retiro';
let mesaNumeroSel = contexto.mesaNumero;
let direccionSel = '';
let zonaSel = null;

// ---------- Toast ----------
let toastTimeout = null;
function mostrarToast(mensaje) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.innerHTML = `<span class="check">${icono('check')}</span> ${esc(mensaje)}`;
  toast.classList.remove('oculto');
  void toast.offsetWidth;
  toast.classList.add('visible');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.classList.add('oculto'), 250);
  }, 1800);
}

// ---------- Carga inicial ----------
async function init() {
  try {
    const [cfgRes, menuRes] = await Promise.all([
      fetch(`/api/${SLUG}/config`),
      fetch(`/api/${SLUG}/menu`),
    ]);

    if (!cfgRes.ok || !menuRes.ok) throw new Error('No se pudo cargar el restaurante');

    CONFIG = await cfgRes.json();
    MENU = await menuRes.json();

    document.title = `${CONFIG.nombre} · Pedidos`;
    $$('.marca span:last-child').forEach(el => {
      el.textContent = CONFIG.nombre;
    });

    // Aplicar los colores del tenant
    aplicarColoresDelTenant(CONFIG.configuracion);

    const s = CONFIG.configuracion.servicios;

    // CASO 1: viene con /mesa/N en la URL pero SIN token
    if (contexto.mesaNumero && !contexto.mesaToken) {
      document.body.innerHTML = `
        <div style="padding:60px 24px;text-align:center;font-family:system-ui">
          <h1 style="font-size:1.5rem;margin:0 0 12px">Pedidos en mesa</h1>
          <p style="color:#666;max-width:400px;margin:0 auto">
            Para ordenar en mesa, escanea el código QR que está en tu mesa.
          </p>
        </div>`;
      return;
    }

    // CASO 2: token válido de mesa
    if (MESA_ACCESO_VALIDO) {
      tipoServicioSel = 'dineIn';
    } else {
      if (s.retiro) tipoServicioSel = 'retiro';
      else if (s.delivery) tipoServicioSel = 'delivery';
      else if (s.dineIn) {
        document.body.innerHTML = `
          <div style="padding:60px 24px;text-align:center;font-family:system-ui">
            <h1 style="font-size:1.5rem;margin:0 0 12px">Pedidos en mesa</h1>
            <p style="color:#666;max-width:400px;margin:0 auto">
              Para ordenar en mesa, escanea el código QR que está en tu mesa.
            </p>
          </div>`;
        return;
      }
    }

    renderMenu();
    renderPanel();
  } catch (err) {
    document.body.innerHTML = `<p style="padding:40px">${esc(err.message)}</p>`;
  }
}

// ---------- Aplicar colores del tenant a las variables CSS ----------
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

// ---------- Cálculo de precio ----------
function calcularPrecioUnitario(item, varianteId, extrasSel, opcionesSel) {
  let precio = item.precio || 0;

  if (item.variantes && item.variantes.length > 0) {
    const v = item.variantes.find(x => x.id === varianteId);
    if (v) precio = v.precio;
  }

  if (item.extras && item.extras.length > 0 && extrasSel) {
    for (const [extId, cantidad] of Object.entries(extrasSel)) {
      if (!cantidad || cantidad <= 0) continue;
      const def = item.extras.find(e => e.id === extId);
      if (def) precio += def.precio * cantidad;
    }
  }

  if (item.opciones && item.opciones.length > 0 && opcionesSel) {
    for (const opDef of item.opciones) {
      const valor = opcionesSel[opDef.id];
      if (opDef.tipo === 'radio' && valor) {
        const valDef = opDef.valores.find(v => v.id === valor);
        if (valDef) precio += valDef.precio || 0;
      }
    }
  }

  return +precio.toFixed(2);
}

function hashItemKey(menuId, varianteId, extrasSel, opcionesSel, notas) {
  const partes = [menuId];
  if (varianteId) partes.push(varianteId);
  if (extrasSel) {
    const extrasOrdenados = Object.entries(extrasSel)
      .filter(([, c]) => c > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}x${v}`)
      .join(',');
    if (extrasOrdenados) partes.push('e:' + extrasOrdenados);
  }
  if (opcionesSel) {
    const opcionesOrdenadas = Object.entries(opcionesSel)
      .filter(([, v]) => v)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    if (opcionesOrdenadas) partes.push('o:' + opcionesOrdenadas);
  }
  if (notas) partes.push('n:' + notas.trim());
  return partes.join('|');
}

function nombreCarrito(entry) {
  const item = MENU.find(m => m._id === entry.menuId);
  if (!item) return '(desconocido)';
  let nombre = item.nombre;
  if (entry.varianteId && item.variantes) {
    const v = item.variantes.find(x => x.id === entry.varianteId);
    if (v) nombre += ` · ${v.nombre}`;
  }
  if (entry.extras && Object.keys(entry.extras).length > 0) {
    const extrasNombres = Object.entries(entry.extras)
      .filter(([, c]) => c > 0)
      .map(([id, c]) => {
        const def = item.extras.find(e => e.id === id);
        return def ? (c > 1 ? `${def.nombre} x${c}` : def.nombre) : null;
      })
      .filter(Boolean);
    if (extrasNombres.length) nombre += ` + ${extrasNombres.join(', ')}`;
  }
  if (entry.opciones && Object.keys(entry.opciones).length > 0) {
    const opcNombres = [];
    for (const [opId, val] of Object.entries(entry.opciones)) {
      const def = item.opciones.find(o => o.id === opId);
      if (!def || !val) continue;
      if (def.tipo === 'radio') {
        const v = def.valores.find(x => x.id === val);
        if (v) opcNombres.push(v.nombre);
      } else if (def.tipo === 'checkbox' && val === true) {
        opcNombres.push(def.nombre);
      }
    }
    if (opcNombres.length) nombre += ` (${opcNombres.join(', ')})`;
  }
  return nombre;
}

// ---------- Render del menú ----------
function renderMenu() {
  const cats = [...new Set(MENU.map(p => p.categoria))];
  const menuEl = document.getElementById('menu');
  if (!menuEl) return;

  const bannerMesa = MESA_ACCESO_VALIDO ? `
    <div class="banner-mesa">
      <div class="banner-mesa-titulo">Mesa ${mesaNumeroSel} · Bienvenido</div>
      <p class="banner-mesa-texto">Si vienen varias personas, cada uno puede pedir desde su celular y todo se sumará en la misma cuenta.</p>
    </div>
  ` : '';

  menuEl.innerHTML = bannerMesa + cats.map(cat => {
    const items = MENU.filter(p => p.categoria === cat);
    const incluirMitad = cat === 'Pizzas' && CONFIG.configuracion.aceptaMitades;
    return `
      <section class="categoria">
        <h2>${esc(cat)}</h2>
        <div class="grid">
          ${incluirMitad ? tarjetaMitad() : ''}
          ${items.map(p => tarjetaProducto(p)).join('')}
        </div>
      </section>
    `;
  }).join('');
}

function tarjetaProducto(p) {
  const tieneVariantes = p.variantes && p.variantes.length > 0;
  const precioMin = tieneVariantes
    ? Math.min(...p.variantes.map(v => v.precio))
    : (p.precio || 0);

  const precioTexto = tieneVariantes
    ? `Desde ${formato(precioMin)}`
    : formato(p.precio || 0);

  const tieneOpciones = (p.extras?.length > 0) || (p.opciones?.length > 0);
  const requiereModal = tieneVariantes || tieneOpciones;

  return `
    <article class="plato">
      ${p.imagen ? `<div class="plato-imagen"><img src="${esc(p.imagen)}" alt="${esc(p.nombre)}" loading="lazy"></div>` : ''}
      <div class="plato-info">
        <h3>${esc(p.nombre)}</h3>
        ${p.descripcion ? `<p class="desc">${esc(p.descripcion)}</p>` : ''}
      </div>
      <div class="plato-accion">
        <span class="precio">${precioTexto}</span>
        <button class="btn btn-agregar" data-id="${p._id}" data-modal="${requiereModal ? '1' : '0'}">
          ${requiereModal ? 'Elegir' : 'Agregar'}
        </button>
      </div>
    </article>
  `;
}

function tarjetaMitad() {
  const pizzas = MENU.filter(p => p.categoria === 'Pizzas' && p.variantes?.length > 0);
  if (pizzas.length < 2) return '';

  const preciosChica = pizzas.map(p => {
    const chica = p.variantes.find(v => v.id === 'chica') || p.variantes[0];
    return chica.precio;
  }).sort((a, b) => a - b);

  const min = (preciosChica[0] + preciosChica[1]) / 2;

  return `
    <article class="plato plato-mitad">
      <div class="plato-info">
        <h3>Por mitades <span class="mitad-badge">2 gustos</span></h3>
        <p class="desc">Elegí dos gustos distintos, uno para cada mitad.</p>
      </div>
      <div class="plato-accion">
        <span class="precio">Desde ${formato(min)}</span>
        <button class="btn btn-agregar-mitad">Elegir mitades</button>
      </div>
    </article>
  `;
}

document.getElementById('menu').addEventListener('click', e => {
  const btnAgregar = e.target.closest('.btn-agregar');
  if (btnAgregar) {
    const id = btnAgregar.dataset.id;
    const item = MENU.find(m => m._id === id);
    if (!item) return;

    const tieneVariantes = item.variantes && item.variantes.length > 0;
    const tieneOpciones = (item.extras?.length > 0) || (item.opciones?.length > 0);

    if (tieneVariantes || tieneOpciones) {
      abrirModalProducto(item);
    } else {
      agregarDirecto(item);
    }
    return;
  }

  const btnMitad = e.target.closest('.btn-agregar-mitad');
  if (btnMitad) return abrirModalMitad();
});

function agregarDirecto(item) {
  const key = hashItemKey(item._id, null, null, null, '');
  if (carrito[key]) {
    carrito[key].cantidad += 1;
  } else {
    carrito[key] = {
      menuId: item._id,
      varianteId: null,
      extras: {},
      opciones: {},
      notas: '',
      cantidad: 1,
    };
  }
  mostrarToast(`${item.nombre} añadido al carrito`);
  renderPanel();
}

// ============================================================
// MODAL GENÉRICO DE PRODUCTO
// ============================================================

function abrirModalProducto(item) {
  const modal = document.getElementById('modal-mitad');
  if (!modal) return;

  const tieneVariantes = item.variantes && item.variantes.length > 0;

  modal.innerHTML = `
    <div class="modal-overlay" data-cerrar-modal></div>
    <div class="modal-contenido">
      <div class="modal-head">
        <h2>${esc(item.nombre)}</h2>
        <button class="btn-icono" data-cerrar-modal type="button">${icono('equis')}</button>
      </div>
      <div class="modal-body">
        ${item.descripcion ? `<p class="modal-sub">${esc(item.descripcion)}</p>` : ''}

        ${tieneVariantes ? `
          <div class="modal-seccion">
            <label class="modal-label">Tamaño / Variante</label>
            <div class="modal-variantes" id="modal-variantes">
              ${item.variantes.map((v, i) => `
                <button class="mitad-opcion ${i === 0 ? 'seleccionada' : ''}"
                        data-variante="${v.id}" type="button">
                  <span class="op-nombre">${esc(v.nombre)}</span>
                  <span class="op-precio">${formato(v.precio)}</span>
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${item.extras && item.extras.length > 0 ? `
          <div class="modal-seccion">
            <label class="modal-label">Extras (opcional)</label>
            <div class="modal-extras">
              ${item.extras.map(ext => `
                <label class="modal-checkbox">
                  <input type="checkbox" data-extra="${ext.id}" data-max="${ext.max || 1}">
                  <span class="modal-checkbox-label">${esc(ext.nombre)}</span>
                  <span class="modal-checkbox-precio">+${formato(ext.precio)}</span>
                </label>
              `).join('')}
            </div>
          </div>
        ` : ''}

        ${item.opciones && item.opciones.length > 0 ? item.opciones.map(op => `
          <div class="modal-seccion">
            <label class="modal-label">${esc(op.nombre)} ${op.requerido ? '<span class="req">*</span>' : ''}</label>
            ${op.tipo === 'radio' ? `
              <div class="modal-opciones">
                ${op.valores.map((v, i) => `
                  <button class="mitad-opcion ${i === 0 ? 'seleccionada' : ''}"
                          data-opcion-radio="${op.id}" data-valor="${v.id}" type="button">
                    <span class="op-nombre">${esc(v.nombre)}</span>
                    ${v.precio ? `<span class="op-precio">+${formato(v.precio)}</span>` : ''}
                  </button>
                `).join('')}
              </div>
            ` : `
              <div class="modal-extras">
                <label class="modal-checkbox">
                  <input type="checkbox" data-opcion-check="${op.id}">
                  <span class="modal-checkbox-label">${esc(op.nombre)}</span>
                </label>
              </div>
            `}
          </div>
        `).join('') : ''}

        <div class="modal-seccion">
          <label class="modal-label">Notas (opcional)</label>
          <textarea id="modal-notas" rows="2" maxlength="200"></textarea>
        </div>

        <div class="mitad-resumen">
          <div class="mitad-precio">
            <span>Precio unitario</span>
            <strong id="modal-precio">$0.00</strong>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn" data-cerrar-modal type="button">Cancelar</button>
        <button class="btn btn-primario" id="modal-agregar" type="button">Agregar al carrito</button>
      </div>
    </div>
  `;

  modal.classList.remove('oculto');
  document.body.style.overflow = 'hidden';

  const estadoModal = {
    varianteId: tieneVariantes ? item.variantes[0].id : null,
    extras: {},
    opciones: {},
  };

  if (item.opciones) {
    for (const op of item.opciones) {
      if (op.tipo === 'radio' && op.valores.length > 0) {
        estadoModal.opciones[op.id] = op.valores[0].id;
      }
    }
  }

  const recalcular = () => {
    const precio = calcularPrecioUnitario(item, estadoModal.varianteId, estadoModal.extras, estadoModal.opciones);
    const el = document.getElementById('modal-precio');
    if (el) el.textContent = formato(precio);
  };

  modal.addEventListener('click', e => {
    if (e.target.closest('[data-cerrar-modal]')) {
      cerrarModal();
      return;
    }

    const btnVariante = e.target.closest('[data-variante]');
    if (btnVariante) {
      estadoModal.varianteId = btnVariante.dataset.variante;
      modal.querySelectorAll('[data-variante]').forEach(b => b.classList.remove('seleccionada'));
      btnVariante.classList.add('seleccionada');
      recalcular();
      return;
    }

    const btnRadio = e.target.closest('[data-opcion-radio]');
    if (btnRadio) {
      const opId = btnRadio.dataset.opcionRadio;
      estadoModal.opciones[opId] = btnRadio.dataset.valor;
      modal.querySelectorAll(`[data-opcion-radio="${opId}"]`).forEach(b => b.classList.remove('seleccionada'));
      btnRadio.classList.add('seleccionada');
      recalcular();
      return;
    }

    if (e.target.closest('#modal-agregar')) {
      agregarDesdeModal(item, estadoModal);
    }
  });

  modal.querySelectorAll('[data-extra]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.extra;
      if (cb.checked) {
        estadoModal.extras[id] = 1;
      } else {
        delete estadoModal.extras[id];
      }
      recalcular();
    });
  });

  modal.querySelectorAll('[data-opcion-check]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.dataset.opcionCheck;
      if (cb.checked) {
        estadoModal.opciones[id] = true;
      } else {
        delete estadoModal.opciones[id];
      }
      recalcular();
    });
  });

  recalcular();
}

function cerrarModal() {
  const modal = document.getElementById('modal-mitad');
  if (!modal) return;
  modal.classList.add('oculto');
  modal.innerHTML = '';
  document.body.style.overflow = '';
}

function agregarDesdeModal(item, estadoModal) {
  if (item.opciones) {
    for (const op of item.opciones) {
      if (op.tipo === 'radio' && op.requerido && !estadoModal.opciones[op.id]) {
        alert(`Seleccioná una opción para "${op.nombre}"`);
        return;
      }
    }
  }

  const notas = (document.getElementById('modal-notas')?.value || '').trim();
  const key = hashItemKey(item._id, estadoModal.varianteId, estadoModal.extras, estadoModal.opciones, notas);

  if (carrito[key]) {
    carrito[key].cantidad += 1;
  } else {
    carrito[key] = {
      menuId: item._id,
      varianteId: estadoModal.varianteId,
      extras: { ...estadoModal.extras },
      opciones: { ...estadoModal.opciones },
      notas,
      cantidad: 1,
    };
  }

  mostrarToast(`${item.nombre} añadido al carrito`);
  cerrarModal();
  renderPanel();
}

// ============================================================
// MODAL DE MITADES
// ============================================================

let mitadSel1 = null;
let mitadSel2 = null;
let mitadVarianteSel = null;

function abrirModalMitad() {
  const modal = document.getElementById('modal-mitad');
  if (!modal) return;

  const pizzas = MENU.filter(p => p.categoria === 'Pizzas' && p.variantes?.length > 0);
  if (pizzas.length < 2) return;

  const variantesComunes = pizzas[0].variantes;

  mitadSel1 = null;
  mitadSel2 = null;
  mitadVarianteSel = variantesComunes[0].id;

  const render = () => {
    const pintarLista = (slot, seleccionado) => pizzas.map(p => `
      <button class="mitad-opcion ${seleccionado === p._id ? 'seleccionada' : ''}"
              data-slot="${slot}" data-id="${p._id}" type="button">
        <span class="op-nombre">${esc(p.nombre)}</span>
      </button>
    `).join('');

    const p1 = MENU.find(p => p._id === mitadSel1);
    const p2 = MENU.find(p => p._id === mitadSel2);
    const v = variantesComunes.find(x => x.id === mitadVarianteSel);

    let precio = 0;
    if (p1 && p2 && v) {
      const precio1 = p1.variantes.find(x => x.id === mitadVarianteSel)?.precio || 0;
      const precio2 = p2.variantes.find(x => x.id === mitadVarianteSel)?.precio || 0;
      precio = (precio1 + precio2) / 2;
    }

    return `
      <div class="modal-seccion">
        <label class="modal-label">Tamaño</label>
        <div class="modal-variantes">
          ${variantesComunes.map(vv => `
            <button class="mitad-opcion ${mitadVarianteSel === vv.id ? 'seleccionada' : ''}"
                    data-mitad-variante="${vv.id}" type="button">
              <span class="op-nombre">${esc(vv.nombre)}</span>
              <span class="op-precio">${formato(vv.precio)}</span>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="mitad-selector">
        <div class="mitad-panel">
          <label class="mitad-label">Primera mitad</label>
          <div class="mitad-lista">${pintarLista(1, mitadSel1)}</div>
        </div>
        <div class="mitad-panel">
          <label class="mitad-label">Segunda mitad</label>
          <div class="mitad-lista">${pintarLista(2, mitadSel2)}</div>
        </div>
      </div>

      <div class="mitad-resumen">
        <div class="mitad-preview">
          <span class="mitad-nombre">${p1 ? esc(p1.nombre) : '—'}</span>
          <span class="mitad-bar"></span>
          <span class="mitad-nombre">${p2 ? esc(p2.nombre) : '—'}</span>
        </div>
        <div class="mitad-precio">
          <span>Precio</span>
          <strong>${formato(precio)}</strong>
        </div>
      </div>

      <div class="modal-footer" style="border-top:none;background:transparent;padding-left:0;padding-right:0;">
        <button class="btn" data-cerrar-modal type="button">Cancelar</button>
        <button class="btn btn-primario" id="mitad-agregar" type="button" ${(!p1 || !p2 || p1._id === p2._id) ? 'disabled' : ''}>
          Agregar al carrito
        </button>
      </div>
    `;
  };

  modal.innerHTML = `
    <div class="modal-overlay" data-cerrar-modal></div>
    <div class="modal-contenido">
      <div class="modal-head">
        <h2>Pizza por mitades</h2>
        <button class="btn-icono" data-cerrar-modal type="button">${icono('equis')}</button>
      </div>
      <div class="modal-body" id="mitad-body"></div>
    </div>
  `;

  const actualizar = () => {
    const bodyEl = document.getElementById('mitad-body');
    if (bodyEl) bodyEl.innerHTML = render();
  };
  actualizar();

  modal.classList.remove('oculto');
  document.body.style.overflow = 'hidden';

  modal.addEventListener('click', e => {
    if (e.target.closest('[data-cerrar-modal]')) {
      cerrarModal();
      return;
    }

    const btnVariante = e.target.closest('[data-mitad-variante]');
    if (btnVariante) {
      mitadVarianteSel = btnVariante.dataset.mitadVariante;
      actualizar();
      return;
    }

    const opcion = e.target.closest('.mitad-opcion[data-slot]');
    if (opcion) {
      const slot = Number(opcion.dataset.slot);
      const id = opcion.dataset.id;
      if (slot === 1) mitadSel1 = mitadSel1 === id ? null : id;
      if (slot === 2) mitadSel2 = mitadSel2 === id ? null : id;
      actualizar();
      return;
    }

    if (e.target.closest('#mitad-agregar')) {
      if (!mitadSel1 || !mitadSel2 || mitadSel1 === mitadSel2) return;
      const p1 = MENU.find(p => p._id === mitadSel1);
      const p2 = MENU.find(p => p._id === mitadSel2);
      const precio1 = p1.variantes.find(v => v.id === mitadVarianteSel)?.precio || 0;
      const precio2 = p2.variantes.find(v => v.id === mitadVarianteSel)?.precio || 0;
      const precio = +((precio1 + precio2) / 2).toFixed(2);
      const varianteNombre = variantesComunes.find(v => v.id === mitadVarianteSel)?.nombre || '';

      const key = `mitad|${mitadSel1}|${mitadSel2}|${mitadVarianteSel}`;
      if (carrito[key]) {
        carrito[key].cantidad += 1;
      } else {
        carrito[key] = {
          esMitad: true,
          menuId1: mitadSel1,
          menuId2: mitadSel2,
          varianteId: mitadVarianteSel,
          nombre: `Mitad ${p1.nombre} / Mitad ${p2.nombre} (${varianteNombre})`,
          precioUnitario: precio,
          notas: '',
          cantidad: 1,
        };
      }
      mostrarToast(`Mitad añadida al carrito`);
      cerrarModal();
      renderPanel();
    }
  });
}

// ============================================================
// CARRITO
// ============================================================

function itemsCarrito() {
  return Object.entries(carrito).map(([key, entry]) => {
    let nombre, precioUnitario;

    if (entry.esMitad) {
      nombre = entry.nombre;
      precioUnitario = entry.precioUnitario;
    } else {
      const item = MENU.find(m => m._id === entry.menuId);
      if (!item) return null;
      nombre = nombreCarrito(entry);
      precioUnitario = calcularPrecioUnitario(item, entry.varianteId, entry.extras, entry.opciones);
    }

    return {
      key,
      nombre,
      precioUnitario,
      cantidad: entry.cantidad,
      subtotal: +(precioUnitario * entry.cantidad).toFixed(2),
    };
  }).filter(Boolean);
}

const totalCarrito = () => itemsCarrito().reduce((s, i) => s + i.subtotal, 0);
const cantidadTotal = () => Object.values(carrito).reduce((s, e) => s + e.cantidad, 0);

function cambiarCantidad(key, delta) {
  if (!carrito[key]) return;
  carrito[key].cantidad += delta;
  if (carrito[key].cantidad <= 0) delete carrito[key];
  renderPanel();
}

function serviciosDisponibles() {
  const s = CONFIG.configuracion.servicios || {};
  const lista = [];

  // Si vinimos de un QR, el único servicio disponible es "En mesa"
  if (MESA_ACCESO_VALIDO) {
    lista.push({ id: 'dineIn', label: `Mesa ${mesaNumeroSel}`, iconoNombre: 'silla' });
    return lista;
  }

  // Caso contrario, nunca mostramos "En mesa"
  if (s.retiro) lista.push({ id: 'retiro', label: 'Retiro en local', iconoNombre: 'casa' });
  if (s.delivery) lista.push({ id: 'delivery', label: 'Delivery', iconoNombre: 'moto' });

  return lista;
}

// ---------- Panel ----------
function renderPanel() {
  const badge = document.getElementById('badge');
  if (badge) badge.textContent = cantidadTotal();

  const body = document.getElementById('panel-body');
  if (!body) return;

  if (pedidoActual) {
    const estados = CONFIG.configuracion.estados || [];
    const estadoActual = estados.find(e => e.id === pedidoActual.estado);
    body.innerHTML = `
      <div class="seguimiento">
        <p class="ok">¡Pedido confirmado!</p>
        <p class="numero">#${pedidoActual.id}</p>
        <p class="estado">${esc(estadoActual?.label || pedidoActual.estado)}</p>
        <p class="sub">Total: ${formato(pedidoActual.total)}</p>
        <div class="aviso-tiempo">
          <span class="tiempo-icono">${icono('reloj')}</span>
          <span class="tiempo-texto">
            Tu pedido estará listo en
            <strong>${CONFIG.configuracion.tiempoEspera} minutos aprox.</strong>
          </span>
        </div>
        <button class="btn" id="btn-nuevo">Hacer otro pedido</button>
      </div>`;
    document.getElementById('btn-nuevo').onclick = () => {
      pedidoActual = null;
      renderPanel();
    };
    return;
  }

  const items = itemsCarrito();
  if (items.length === 0) {
    body.innerHTML = `<div class="vacio">
      <span class="icono-pizza"></span>
      <p>Todavía no agregaste nada</p>
    </div>`;
    return;
  }

  const subtotal = totalCarrito();
  const iva = +(subtotal * IVA_RATE).toFixed(2);

  let costoEnvio = 0;
  let zonaInfo = null;
  if (tipoServicioSel === 'delivery') {
    const zonas = CONFIG.configuracion.delivery?.zonas || [];
    const zona = zonas.find(z => z.id === zonaSel);
    if (zona) {
      costoEnvio = zona.costo || 0;
      zonaInfo = zona;
    }
  }

  const total = +(subtotal + iva + costoEnvio).toFixed(2);
  const servicios = serviciosDisponibles();
  const esDineIn = tipoServicioSel === 'dineIn';
  const mostrarSelector = servicios.length > 1;

  body.innerHTML = `
    <ul class="lista">
      ${items.map(i => `
        <li class="linea">
          <div>
            <strong>${esc(i.nombre)}</strong>
            <div class="sub">${formato(i.precioUnitario)} c/u</div>
          </div>
          <div class="contador">
            <button data-menos="${i.key}">${icono('menos')}</button>
            <span>${i.cantidad}</span>
            <button data-mas="${i.key}">${icono('mas')}</button>
          </div>
          <span class="subtotal">${formato(i.subtotal)}</span>
        </li>`).join('')}
    </ul>

    ${mostrarSelector ? `
      <div class="selector-servicio">
        <label class="modal-label">Tipo de servicio</label>
        <div class="selector-servicio-opciones">
          ${servicios.map(s => `
            <button class="servicio-opcion ${tipoServicioSel === s.id ? 'seleccionada' : ''}"
                    data-servicio="${s.id}" type="button">
              <span class="servicio-icono">${icono(s.iconoNombre)}</span>
              <span class="servicio-label">${esc(s.label)}</span>
            </button>
          `).join('')}
        </div>
      </div>
    ` : ''}

    ${esDineIn ? `
      <div class="aviso-mesa-compartida">
        <strong>Estás ordenando para la Mesa ${mesaNumeroSel}</strong>
        Si vienen varias personas, cada uno puede pedir desde su celular y todo se sumará en la misma cuenta.
      </div>
    ` : ''}

    ${tipoServicioSel === 'delivery' ? `
      <div class="selector-servicio">
        <label class="modal-label">Dirección de entrega</label>
        <input type="text" id="input-direccion" placeholder="Calle, número, colonia"
               maxlength="200" value="${esc(direccionSel)}">
        <label class="modal-label" style="margin-top:12px;">Zona</label>
        <div class="selector-servicio-opciones">
          ${(CONFIG.configuracion.delivery?.zonas || []).map(z => `
            <button class="servicio-opcion ${zonaSel === z.id ? 'seleccionada' : ''}"
                    data-zona="${z.id}" type="button">
              <span class="servicio-label">${esc(z.nombre)}</span>
              <span class="servicio-precio">+${formato(z.costo)}</span>
            </button>
          `).join('')}
        </div>
      </div>
    ` : ''}

    <div class="aviso-tiempo">
      <span class="tiempo-icono">${icono('reloj')}</span>
      <span class="tiempo-texto">
        Tiempo estimado de preparación
        <strong>~${CONFIG.configuracion.tiempoEspera} minutos</strong>
      </span>
    </div>

    <form id="form-pedido" class="form">
      <label>Nombre <input name="nombre" required maxlength="80" /></label>
      ${!esDineIn ? `
        <label>Teléfono <input name="telefono" required maxlength="30" /></label>
      ` : ''}
      <label>Notas (opcional) <textarea name="notas" rows="2" maxlength="300"></textarea></label>

      <div class="desglose">
        <div class="desglose-linea">
          <span>Subtotal</span>
          <strong>${formato(subtotal)}</strong>
        </div>
        <div class="desglose-linea">
          <span>IVA (16%)</span>
          <strong>${formato(iva)}</strong>
        </div>
        ${costoEnvio > 0 ? `
          <div class="desglose-linea">
            <span>Envío ${zonaInfo ? `· ${esc(zonaInfo.nombre)}` : ''}</span>
            <strong>${formato(costoEnvio)}</strong>
          </div>
        ` : ''}
        <div class="total">
          <span>Total</span>
          <strong>${formato(total)}</strong>
        </div>
      </div>

      <button class="btn btn-primario btn-grande" type="submit">Confirmar pedido</button>
    </form>`;

  body.querySelectorAll('[data-mas]').forEach(b => b.onclick = () => cambiarCantidad(b.dataset.mas, 1));
  body.querySelectorAll('[data-menos]').forEach(b => b.onclick = () => cambiarCantidad(b.dataset.menos, -1));

  body.querySelectorAll('[data-servicio]').forEach(b => b.onclick = () => {
    tipoServicioSel = b.dataset.servicio;
    renderPanel();
  });

  body.querySelectorAll('[data-zona]').forEach(b => b.onclick = () => {
    zonaSel = b.dataset.zona;
    renderPanel();
  });

  const inputDir = document.getElementById('input-direccion');
  if (inputDir) {
    inputDir.oninput = (e) => { direccionSel = e.target.value; };
  }

  document.getElementById('form-pedido').onsubmit = enviarPedido;
}

// ---------- Enviar pedido ----------
async function enviarPedido(e) {
  e.preventDefault();
  const f = e.target;

  if (tipoServicioSel === 'delivery') {
    if (!direccionSel.trim()) return alert('Ingresá una dirección de entrega');
    if (!zonaSel) return alert('Seleccioná una zona de entrega');
  }

  const itemsPayload = Object.entries(carrito).map(([key, entry]) => {
    if (entry.esMitad) {
      return {
        id: `${entry.menuId1}+${entry.menuId2}`,
        cantidad: entry.cantidad,
        notas: entry.notas || '',
      };
    }
    return {
      id: entry.menuId,
      cantidad: entry.cantidad,
      varianteId: entry.varianteId,
      extras: Object.entries(entry.extras)
        .filter(([, c]) => c > 0)
        .map(([id, cantidad]) => ({ id, cantidad })),
      opciones: entry.opciones,
      notas: entry.notas || '',
    };
  });

  const telefono = f.telefono ? f.telefono.value.trim() : '';

  const payload = {
    tipoServicio: tipoServicioSel,
    cliente: {
      nombre: f.nombre.value.trim(),
      telefono,
    },
    notas: f.notas.value.trim(),
    items: itemsPayload,
    direccion: tipoServicioSel === 'delivery' ? direccionSel.trim() : null,
    zonaId: tipoServicioSel === 'delivery' ? zonaSel : null,
    numeroMesa: tipoServicioSel === 'dineIn' ? mesaNumeroSel : null,
    mesaToken: tipoServicioSel === 'dineIn' ? contexto.mesaToken : null,
  };

  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Enviando…';

  try {
    const res = await fetch(`/api/${SLUG}/pedidos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo enviar el pedido');

    pedidoActual = {
      id: data.id,
      total: data.total,
      estado: data.estado,
    };
    carrito = {};
    zonaSel = null;
    direccionSel = '';
    renderPanel();
    seguirPedido();
  } catch (err) {
    alert(err.message);
    btn.disabled = false;
    btn.textContent = 'Confirmar pedido';
  }
}

// ---------- Seguimiento ----------
function seguirPedido() {
  clearInterval(intervalo);
  intervalo = setInterval(async () => {
    if (!pedidoActual) return clearInterval(intervalo);
    try {
      const res = await fetch(`/api/${SLUG}/pedidos/${pedidoActual.id}/estado`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.estado !== pedidoActual.estado) {
        pedidoActual.estado = data.estado;
        renderPanel();
      }
    } catch {}
  }, 5000);
}

// ---------- Abrir / cerrar panel ----------
const abrirPanel = abrir => {
  document.getElementById('panel').classList.toggle('oculto', !abrir);
  document.getElementById('overlay').classList.toggle('oculto', !abrir);
};

const btnCarrito = document.getElementById('btn-carrito');
const btnCerrar = document.getElementById('btn-cerrar');
const overlay = document.getElementById('overlay');
if (btnCarrito) btnCarrito.onclick = () => abrirPanel(true);
if (btnCerrar) btnCerrar.onclick = () => abrirPanel(false);
if (overlay) overlay.onclick = () => abrirPanel(false);

// ---------- Arranque ----------
init();