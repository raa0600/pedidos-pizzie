// ============================================================
// HERMES · Sistema de diálogos estilo Swiss
// ============================================================

let dialogoContainer = null;

function crearContainerSiFalta() {
  if (dialogoContainer && document.body.contains(dialogoContainer)) return dialogoContainer;
  dialogoContainer = document.createElement('div');
  dialogoContainer.id = 'dialogo-container';
  document.body.appendChild(dialogoContainer);
  return dialogoContainer;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Detecta el tipo por el contenido y limpia emojis del inicio
function detectarTipoYLimpiar(mensaje, tituloSugerido) {
  let texto = String(mensaje || '');
  let tipo = 'info';
  let titulo = tituloSugerido || 'Aviso';

  // Lista de emojis que se quitan del inicio
  const emojisInicio = [
    '✅', '✓', '☑', '🎉',
    '⚠️', '⚠', '❌', '🚫',
    'ℹ️', 'ℹ', '💡',
    '📝', '📋', '📌',
  ];

  // Limpia emojis del inicio (puede haber varios seguidos)
  let cambio = true;
  while (cambio) {
    cambio = false;
    texto = texto.trimStart();
    for (const emoji of emojisInicio) {
      if (texto.startsWith(emoji)) {
        texto = texto.slice(emoji.length).trimStart();
        cambio = true;
        break;
      }
    }
  }

  // Detecta el tipo por palabras clave del texto original
  const original = String(mensaje || '');

  if (original.includes('✅') || /^correcto|^exito|^éxito|^listo|^guardado|^actualizado|^creado|^reseteado/i.test(original)) {
    tipo = 'exito';
    if (!tituloSugerido) titulo = 'Listo';
  } else if (original.includes('❌') || /^error|^fall|^no se pudo/i.test(texto)) {
    tipo = 'error';
    if (!tituloSugerido) titulo = 'Error';
  } else if (original.includes('⚠️') || original.includes('⚠') || /^atención|^atencion|^advertencia|^cuidado|^demasiados/i.test(texto)) {
    tipo = 'advertencia';
    if (!tituloSugerido) titulo = 'Atención';
  }

  return { texto: texto.trim(), tipo, titulo };
}

function obtenerIconoPorTipo(tipo) {
  return {
    exito: 'check_circulo',
    error: 'equis_circulo',
    advertencia: 'advertencia',
    info: 'info',
  }[tipo] || 'info';
}

function crearDialogo({ titulo, mensaje, tipo = 'info', campos = [], botones }) {
  return new Promise((resolve) => {
    const container = crearContainerSiFalta();

    const camposHTML = campos.map((c, i) => `
      <label class="dlg-label">
        ${c.label ? escapeHtml(c.label) : ''}
        <input type="${c.tipo || 'text'}"
               class="dlg-input"
               data-idx="${i}"
               value="${escapeHtml(c.valor || '')}"
               placeholder="${escapeHtml(c.placeholder || '')}">
      </label>
    `).join('');

    const botonesHTML = botones.map((b, i) => {
      const clase = b.estilo === 'primario' ? 'btn btn-primario'
                  : b.estilo === 'peligro' ? 'btn btn-peligro'
                  : 'btn';
      return `<button class="${clase}" data-btn-idx="${i}" type="button">${escapeHtml(b.texto)}</button>`;
    }).join('');

    const overlay = document.createElement('div');
    overlay.className = 'dlg-overlay';
    overlay.innerHTML = `
      <div class="dlg-contenido dlg-tipo-${tipo}" role="dialog" aria-modal="true">
        <div class="dlg-head">
          <h2 class="dlg-titulo">
            <span class="dlg-icono">${icono(obtenerIconoPorTipo(tipo))}</span>
            <span>${escapeHtml(titulo || '')}</span>
          </h2>
        </div>
        <div class="dlg-body">
          ${mensaje ? `<p class="dlg-mensaje">${escapeHtml(mensaje).replace(/\n/g, '<br>')}</p>` : ''}
          ${camposHTML ? `<div class="dlg-campos">${camposHTML}</div>` : ''}
        </div>
        <div class="dlg-footer">${botonesHTML}</div>
      </div>
    `;

    container.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    setTimeout(() => {
      const primerInput = overlay.querySelector('.dlg-input');
      if (primerInput) primerInput.focus();
      else {
        const primerBtn = overlay.querySelector('[data-btn-idx]');
        if (primerBtn) primerBtn.focus();
      }
    }, 50);

    const cerrar = (resultado) => {
      overlay.classList.add('dlg-saliendo');
      setTimeout(() => {
        overlay.remove();
        if (container.children.length === 0) {
          document.body.style.overflow = '';
        }
      }, 150);
      resolve(resultado);
    };

    overlay.querySelectorAll('[data-btn-idx]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.btnIdx, 10);
        const boton = botones[idx];

        if (boton.recogeValor) {
          const inputs = overlay.querySelectorAll('.dlg-input');
          const valores = [];
          for (let i = 0; i < inputs.length; i++) {
            const val = inputs[i].value.trim();
            if (campos[i].required && !val) {
              inputs[i].classList.add('dlg-error');
              inputs[i].focus();
              return;
            }
            valores.push(val);
          }
          cerrar(valores.length === 1 ? valores[0] : valores);
          return;
        }

        cerrar(boton.valor);
      });
    });

    const cancelar = () => {
      const botonCancelar = botones.find(b => b.valor === false || b.valor === null);
      if (botonCancelar) cerrar(botonCancelar.valor);
    };

    document.addEventListener('keydown', function onKey(e) {
      if (e.key === 'Escape') {
        document.removeEventListener('keydown', onKey);
        cancelar();
      }
      if (e.key === 'Enter' && campos.length > 0) {
        const btnPrimario = overlay.querySelector('[data-btn-idx]:last-child');
        if (btnPrimario) btnPrimario.click();
      }
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cancelar();
    });
  });
}

// ---------- API pública ----------

async function alerta(mensaje, tituloManual) {
  const { texto, tipo, titulo } = detectarTipoYLimpiar(mensaje, tituloManual);

  return crearDialogo({
    titulo: tituloManual || titulo,
    mensaje: texto,
    tipo,
    botones: [{ texto: 'Aceptar', valor: true, estilo: 'primario' }],
  });
}

async function confirmar(mensaje, opciones = {}) {
  return crearDialogo({
    titulo: opciones.titulo || 'Confirmar',
    mensaje,
    tipo: opciones.tipo === 'peligro' ? 'advertencia' : 'info',
    botones: [
      { texto: opciones.textoCancelar || 'Cancelar', valor: false },
      { texto: opciones.textoAceptar || 'Confirmar', valor: true,
        estilo: opciones.tipo === 'peligro' ? 'peligro' : 'primario' },
    ],
  });
}

async function pedir(mensaje, valorDefault = '', opciones = {}) {
  return crearDialogo({
    titulo: opciones.titulo || 'Ingresar',
    mensaje,
    tipo: 'info',
    campos: [{
      label: opciones.label || '',
      valor: valorDefault,
      placeholder: opciones.placeholder || '',
      required: opciones.required !== false,
    }],
    botones: [
      { texto: opciones.textoCancelar || 'Cancelar', valor: null },
      { texto: opciones.textoAceptar || 'Aceptar', valor: true, estilo: 'primario', recogeValor: true },
    ],
  });
}

// ---------- Polyfill: sobreescribe window.alert ----------
if (typeof window !== 'undefined') {
  window.alert = (mensaje) => {
    alerta(mensaje);
  };
}