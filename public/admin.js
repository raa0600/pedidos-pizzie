const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g,
  c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const formato = n => '$' + n.toFixed(2);

const SIGUIENTE = { pendiente: 'preparando', preparando: 'listo', listo: 'entregado' };
const ETIQUETA_BOTON = {
  pendiente: 'Empezar a preparar',
  preparando: 'Marcar listo',
  listo: 'Marcar entregado',
};

let pin = sessionStorage.getItem('pin') || '';
let pedidos = [];
let filtro = 'activos';
let idsConocidos = new Set();
let primeraCarga = true;

async function cargar() {
  try {
    const res = await fetch('/api/pedidos', { headers: { 'x-admin-pin': pin } });
    if (res.status === 401) return pedirPin();
    if (!res.ok) return;
    pedidos = await res.json();
    detectarNuevos();
    render();
  } catch (e) {
    console.error(e);
  }
}

function pedirPin() {
  const intento = prompt('PIN del panel:');
  if (intento === null) return;
  pin = intento.trim();
  sessionStorage.setItem('pin', pin);
  cargar();
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
  } catch {}
}

function render() {
  const activos = pedidos.filter(p => ['pendiente', 'preparando', 'listo'].includes(p.estado));
  $('#contador').textContent = activos.length;

  const lista =
    filtro === 'activos' ? activos :
    filtro === 'todos'   ? pedidos :
    pedidos.filter(p => p.estado === filtro);

  const chips = [
    ['activos', `Activos (${activos.length})`],
    ['pendiente', 'Pendientes'],
    ['preparando', 'Preparando'],
    ['listo', 'Listos'],
    ['entregado', 'Entregados'],
    ['todos', 'Todos'],
  ];
  $('#filtros').innerHTML = chips.map(([v, t]) =>
    `<button class="chip ${filtro === v ? 'activo' : ''}" data-filtro="${v}">${t}</button>`
  ).join('');

  $('#pedidos').innerHTML = lista.length === 0
    ? '<p class="vacio">No hay pedidos en esta vista.</p>'
    : lista.map(tarjeta).join('');
}

function tarjeta(p) {
  const hora = new Date(p.creado).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  return `
    <article class="pedido estado-${p.estado}">
      <header>
        <div><strong>#${p.id}</strong><span class="hora">${hora}</span></div>
        <span class="tag">${p.estado}</span>
      </header>
      <p class="cliente">👤 ${esc(p.cliente.nombre)} · ${esc(p.cliente.telefono)}</p>
      <p class="cliente">🏠 Retira en el local</p>
      <ul class="items">
        ${p.items.map(i => `<li><span>${i.cantidad}× ${esc(i.nombre)}</span><span>${formato(i.subtotal)}</span></li>`).join('')}
      </ul>
      ${p.notas ? `<p class="notas">📝 ${esc(p.notas)}</p>` : ''}
      <footer>
        <strong class="total">${formato(p.total)}</strong>
        <div class="botones">
          ${SIGUIENTE[p.estado]
            ? `<button class="btn btn-primario" data-avanzar="${p.id}">${ETIQUETA_BOTON[p.estado]}</button>`
            : ''}
          ${p.estado !== 'entregado' && p.estado !== 'cancelado'
            ? `<button class="btn btn-peligro" data-cancelar="${p.id}">Cancelar</button>`
            : ''}
        </div>
      </footer>
    </article>`;
}

$('#pedidos').addEventListener('click', async e => {
  const avanzar = e.target.closest('[data-avanzar]');
  const cancelar = e.target.closest('[data-cancelar]');

  if (avanzar) {
    const p = pedidos.find(x => x.id === avanzar.dataset.avanzar);
    if (p) await cambiarEstado(p.id, SIGUIENTE[p.estado]);
  }
  if (cancelar && confirm('¿Cancelar este pedido?')) {
    await cambiarEstado(cancelar.dataset.cancelar, 'cancelado');
  }
});

$('#filtros').addEventListener('click', e => {
  const chip = e.target.closest('[data-filtro]');
  if (!chip) return;
  filtro = chip.dataset.filtro;
  render();
});

async function cambiarEstado(id, estado) {
  const res = await fetch(`/api/pedidos/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'x-admin-pin': pin },
    body: JSON.stringify({ estado }),
  });
  if (res.ok) cargar();
}

$('#btn-refrescar').onclick = cargar;
$('#btn-salir').onclick = () => {
  sessionStorage.removeItem('pin');
  pin = '';
  pedirPin();
};

if (pin) cargar(); else pedirPin();
setInterval(() => { if (pin) cargar(); }, 5000);