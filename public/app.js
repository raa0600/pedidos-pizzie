// ---------- Helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g,
  c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const formato = n => '$' + n.toFixed(2);

// ---------- Configuración ----------
const TIEMPO_ESPERA_MIN = 45; // minutos que tarda la pizza en estar lista

// ---------- Estado ----------
let MENU = [];
let carrito = {};
let pedidoActual = null;
let intervalo = null;

// Estado del modal de mitades
let mitadSel1 = null;
let mitadSel2 = null;

// ---------- Toast ----------
let toastTimeout = null;

function mostrarToast(mensaje) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.innerHTML = `<span class="check">✓</span> ${esc(mensaje)}`;

  toast.classList.remove('oculto');
  void toast.offsetWidth;
  toast.classList.add('visible');

  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.classList.add('oculto'), 250);
  }, 1800);
}

// ---------- Menú ----------
async function cargarMenu() {
  MENU = await (await fetch('/api/menu')).json();
  renderMenu();
  renderPanel();
}

function renderMenu() {
  const cats = [...new Set(MENU.map(p => p.categoria))];
  $('#menu').innerHTML = cats.map(cat => `
    <section class="categoria">
      <h2>${esc(cat)}</h2>
      <div class="grid">
        ${cat === 'Pizzas' ? tarjetaMitad() : ''}
        ${MENU.filter(p => p.categoria === cat).map(p => `
          <article class="plato">
            <div class="plato-info">
              <h3>${esc(p.nombre)}</h3>
              ${p.descripcion ? `<p class="desc">${esc(p.descripcion)}</p>` : ''}
            </div>
            <div class="plato-accion">
              <span class="precio">${formato(p.precio)}</span>
              <button class="btn btn-agregar" data-id="${p.id}">Agregar</button>
            </div>
          </article>
        `).join('')}
      </div>
    </section>
  `).join('');
}

function tarjetaMitad() {
  const precios = MENU.filter(p => p.categoria === 'Pizzas')
    .map(p => p.precio).sort((a, b) => a - b);
  const min = precios.length >= 2
    ? (precios[0] + precios[1]) / 2
    : (precios[0] || 0);

  return `
    <article class="plato plato-mitad">
      <div class="plato-info">
        <h3>Por mitades <span class="mitad-badge">2 tipos</span></h3>
        <p class="desc">Elige dos sabores distintos, uno para cada mitad de la pizza.</p>
      </div>
      <div class="plato-accion">
        <span class="precio">Desde ${formato(min)}</span>
        <button class="btn btn-agregar-mitad">Elegir mitades</button>
      </div>
    </article>
  `;
}

$('#menu').addEventListener('click', e => {
  const btnNormal = e.target.closest('.btn-agregar');
  if (btnNormal) return agregar(btnNormal.dataset.id);

  const btnMitad = e.target.closest('.btn-agregar-mitad');
  if (btnMitad) return abrirModalMitad();
});

function agregar(id) {
  carrito[id] = (carrito[id] || 0) + 1;
  const producto = MENU.find(p => p.id === id);
  if (producto) mostrarToast(`${producto.nombre} añadido al carrito`);
  renderPanel();
}

function cambiar(id, delta) {
  carrito[id] = (carrito[id] || 0) + delta;
  if (carrito[id] <= 0) {
    delete carrito[id];
    const nombre = nombreDeItem(id);
    if (nombre) mostrarToast(`${nombre} quitado del carrito`);
  }
  renderPanel();
}

// Devuelve el nombre legible de un item, sea simple o mitad
function nombreDeItem(id) {
  if (id.includes('+')) {
    const [a, b] = id.split('+');
    const p1 = MENU.find(x => x.id === a);
    const p2 = MENU.find(x => x.id === b);
    if (p1 && p2) return `Mitad ${p1.nombre} / ${p2.nombre}`;
    return null;
  }
  const p = MENU.find(x => x.id === id);
  return p ? p.nombre : null;
}

// Convierte carrito en items con precio y subtotal (maneja mitades)
function itemsCarrito() {
  return Object.entries(carrito).map(([id, cantidad]) => {
    if (id.includes('+')) {
      const [a, b] = id.split('+');
      const p1 = MENU.find(x => x.id === a);
      const p2 = MENU.find(x => x.id === b);
      if (!p1 || !p2) return null;
      const precio = +((p1.precio + p2.precio) / 2).toFixed(2);
      return {
        id,
        nombre: `Mitad ${p1.nombre} / Mitad ${p2.nombre}`,
        precio,
        cantidad,
        subtotal: +(precio * cantidad).toFixed(2),
      };
    }
    const p = MENU.find(x => x.id === id);
    if (!p) return null;
    return { ...p, cantidad, subtotal: p.precio * cantidad };
  }).filter(Boolean);
}

const totalCarrito = () => itemsCarrito().reduce((s, i) => s + i.subtotal, 0);
const cantidadTotal = () => Object.values(carrito).reduce((a, b) => a + b, 0);

// ---------- Modal de mitades ----------
function abrirModalMitad() {
  mitadSel1 = null;
  mitadSel2 = null;
  renderModalMitad();
  $('#modal-mitad').classList.remove('oculto');
  document.body.style.overflow = 'hidden';
}

function cerrarModalMitad() {
  $('#modal-mitad').classList.add('oculto');
  document.body.style.overflow = '';
}

function renderModalMitad() {
  const pizzas = MENU.filter(p => p.categoria === 'Pizzas');
  const pintarLista = (slot, seleccionado) => pizzas.map(p => `
    <button class="mitad-opcion ${seleccionado === p.id ? 'seleccionada' : ''}"
            data-slot="${slot}" data-id="${p.id}" type="button">
      <span class="op-nombre">${esc(p.nombre)}</span>
      <span class="op-precio">${formato(p.precio)}</span>
    </button>
  `).join('');

  $('#mitad-1-lista').innerHTML = pintarLista(1, mitadSel1);
  $('#mitad-2-lista').innerHTML = pintarLista(2, mitadSel2);

  const p1 = MENU.find(p => p.id === mitadSel1);
  const p2 = MENU.find(p => p.id === mitadSel2);

  $('#mitad-1-nombre').textContent = p1 ? p1.nombre : '—';
  $('#mitad-2-nombre').textContent = p2 ? p2.nombre : '—';

  const precio = p1 && p2 ? (p1.precio + p2.precio) / 2 : 0;
  $('#mitad-precio').textContent = formato(precio);

  const btn = $('#btn-agregar-mitad');
  if (p1 && p2 && p1.id === p2.id) {
    btn.disabled = true;
    btn.textContent = 'Elige dos sabores distintos';
  } else if (p1 && p2) {
    btn.disabled = false;
    btn.textContent = 'Agregar al carrito';
  } else {
    btn.disabled = true;
    btn.textContent = 'Agregar al carrito';
  }
}

$('#modal-mitad').addEventListener('click', e => {
  if (e.target.closest('[data-cerrar-modal]')) {
    return cerrarModalMitad();
  }

  const opcion = e.target.closest('.mitad-opcion');
  if (opcion) {
    const slot = Number(opcion.dataset.slot);
    const id = opcion.dataset.id;
    if (slot === 1) mitadSel1 = mitadSel1 === id ? null : id;
    if (slot === 2) mitadSel2 = mitadSel2 === id ? null : id;
    renderModalMitad();
    return;
  }

  if (e.target.closest('#btn-agregar-mitad')) {
    if (!mitadSel1 || !mitadSel2 || mitadSel1 === mitadSel2) return;
    const id = `${mitadSel1}+${mitadSel2}`;
    carrito[id] = (carrito[id] || 0) + 1;
    const nombre = nombreDeItem(id);
    if (nombre) mostrarToast(`${nombre} añadida al carrito`);
    cerrarModalMitad();
    renderPanel();
  }
});

// ---------- Estados de pedido ----------
const ETIQUETAS = {
  pendiente: 'Recibido ✅',
  preparando: 'En el horno 🔥',
  listo: 'Listo para retirar <span class="icono-pizza"></span>',
  entregado: 'Entregado 🎉',
  cancelado: 'Cancelado ❌',
};

// ---------- Panel del cliente ----------
function renderPanel() {
  $('#badge').textContent = cantidadTotal();
  const body = $('#panel-body');

  // Pedido enviado → seguimiento
  if (pedidoActual) {
    body.innerHTML = `
      <div class="seguimiento">
        <p class="ok">¡Pedido confirmado!</p>
        <p class="numero">#${pedidoActual.id}</p>
        <p class="estado">${ETIQUETAS[pedidoActual.estado] || pedidoActual.estado}</p>
        <p class="sub">Total: ${formato(pedidoActual.total)}</p>

        <div class="aviso-tiempo">
          <span class="tiempo-icono">🕐</span>
          <span class="tiempo-texto">
            Tu pedido estará listo en
            <strong>${TIEMPO_ESPERA_MIN} minutos aprox.</strong>
          </span>
        </div>

        <button class="btn" id="btn-nuevo">Hacer otro pedido</button>
      </div>`;
    body.querySelector('#btn-nuevo').onclick = () => {
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

  body.innerHTML = `
    <ul class="lista">
      ${items.map(i => `
        <li class="linea">
          <div>
            <strong>${esc(i.nombre)}</strong>
            <div class="sub">${formato(i.precio)} c/u</div>
          </div>
          <div class="contador">
            <button data-menos="${i.id}">−</button>
            <span>${i.cantidad}</span>
            <button data-mas="${i.id}">+</button>
          </div>
          <span class="subtotal">${formato(i.subtotal)}</span>
        </li>`).join('')}
    </ul>

    <p class="aviso-retiro">🏠 Retiro en el local</p>

    <div class="aviso-tiempo">
      <span class="tiempo-icono">🕐</span>
      <span class="tiempo-texto">
        Tiempo de preparación estimado
        <strong>~${TIEMPO_ESPERA_MIN} minutos</strong>
      </span>
    </div>

    <form id="form-pedido" class="form">
      <label>Nombre <input name="nombre" required maxlength="80" /></label>
      <label>Teléfono <input name="telefono" required maxlength="30" /></label>
      <label>Notas (opcional) <textarea name="notas" rows="2" maxlength="300"></textarea></label>

      <div class="total"><span>Total</span><strong>${formato(totalCarrito())}</strong></div>
      <button class="btn btn-primario btn-grande" type="submit">Confirmar pedido</button>
    </form>`;

  body.querySelectorAll('[data-mas]').forEach(b => b.onclick = () => {
    carrito[b.dataset.mas] = (carrito[b.dataset.mas] || 0) + 1;
    renderPanel();
  });
  body.querySelectorAll('[data-menos]').forEach(b => b.onclick = () => {
    const id = b.dataset.menos;
    carrito[id] = (carrito[id] || 0) - 1;
    if (carrito[id] <= 0) delete carrito[id];
    renderPanel();
  });

  $('#form-pedido').onsubmit = enviarPedido;
}

// ---------- Enviar pedido ----------
async function enviarPedido(e) {
  e.preventDefault();
  const f = e.target;

  const payload = {
    tipo: 'retiro',
    cliente: {
      nombre: f.nombre.value.trim(),
      telefono: f.telefono.value.trim(),
    },
    notas: f.notas.value.trim(),
    items: Object.entries(carrito).map(([id, cantidad]) => ({ id, cantidad })),
  };

  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true;
  btn.textContent = 'Enviando…';

  try {
    const res = await fetch('/api/pedidos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'No se pudo enviar el pedido');

    pedidoActual = { id: data.id, total: data.total, estado: data.estado };
    carrito = {};
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
      const res = await fetch(`/api/pedidos/${pedidoActual.id}/estado`);
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
  $('#panel').classList.toggle('oculto', !abrir);
  $('#overlay').classList.toggle('oculto', !abrir);
};
$('#btn-carrito').onclick = () => abrirPanel(true);
$('#btn-cerrar').onclick = () => abrirPanel(false);
$('#overlay').onclick = () => abrirPanel(false);

// ---------- Arranque ----------
cargarMenu();