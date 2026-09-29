// ---------- Helpers ----------
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g,
  c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const formato = n => '$' + n.toFixed(2);

// ---------- Estado ----------
let MENU = [];
let carrito = {};        // id -> cantidad
let pedidoActual = null; // { id, total, estado }
let intervalo = null;

// ---------- Toast ----------
let toastTimeout = null;

function mostrarToast(mensaje) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.innerHTML = `<span class="check">✓</span> ${esc(mensaje)}`;

  toast.classList.remove('oculto');
  void toast.offsetWidth; // fuerza reflow para reiniciar la transición
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

$('#menu').addEventListener('click', e => {
  const btn = e.target.closest('.btn-agregar');
  if (btn) agregar(btn.dataset.id);
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
    const producto = MENU.find(p => p.id === id);
    if (producto) mostrarToast(`${producto.nombre} quitado del carrito`);
  }
  renderPanel();
}

function itemsCarrito() {
  return Object.entries(carrito).map(([id, cantidad]) => {
    const p = MENU.find(x => x.id === id);
    return { ...p, cantidad, subtotal: p.precio * cantidad };
  });
}
const totalCarrito = () => itemsCarrito().reduce((s, i) => s + i.subtotal, 0);
const cantidadTotal = () => Object.values(carrito).reduce((a, b) => a + b, 0);

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

  // Pedido ya enviado → mostrar seguimiento
  if (pedidoActual) {
    body.innerHTML = `
      <div class="seguimiento">
        <p class="ok">¡Pedido confirmado!</p>
        <p class="numero">#${pedidoActual.id}</p>
        <p class="estado">${ETIQUETAS[pedidoActual.estado] || pedidoActual.estado}</p>
        <p class="sub">Total: ${formato(pedidoActual.total)}</p>
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

    <form id="form-pedido" class="form">
      <label>Nombre <input name="nombre" required maxlength="80" /></label>
      <label>Teléfono <input name="telefono" required maxlength="30" /></label>
      <label>Notas (opcional) <textarea name="notas" rows="2" maxlength="300"></textarea></label>

      <div class="total"><span>Total</span><strong>${formato(totalCarrito())}</strong></div>
      <button class="btn btn-primario btn-grande" type="submit">Confirmar pedido</button>
    </form>`;

  // Botones + y − dentro del carrito (no disparan toast)
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