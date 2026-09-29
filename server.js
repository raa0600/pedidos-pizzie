// ---------- Carga de variables de entorno ----------
const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '.env'),
  override: true,
});

// ---------- Diagnóstico (descomenta si hay problemas con .env) ----------
// console.log('📁 __dirname:', __dirname);
// console.log('📁 CWD:', process.cwd());
// console.log('🔍 MONGO_URI:', process.env.MONGO_URI ? 'OK' : 'NO');

// ---------- Imports ----------
const express = require('express');
const fs = require('fs');
const crypto = require('crypto');
const { MongoClient } = require('mongodb');

// ---------- Configuración ----------
const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
const DB_NAME = process.env.DB_NAME || 'pizzeria';
const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('❌ Falta MONGO_URI en las variables de entorno.');
  console.error('   Verifica que el archivo .env esté en:', __dirname);
  process.exit(1);
}

const MENU = JSON.parse(fs.readFileSync(path.join(__dirname, 'menu.json'), 'utf8'));

// ---------- Conexión a MongoDB ----------
const client = new MongoClient(MONGO_URI);
let pedidosCol;

async function conectarDB() {
  await client.connect();
  const db = client.db(DB_NAME);
  pedidosCol = db.collection('pedidos');

  await pedidosCol.createIndex({ creado: -1 });
  await pedidosCol.createIndex({ estado: 1 });
  await pedidosCol.createIndex({ id: 1 }, { unique: true });

  console.log(`✅ Conectado a MongoDB (base: ${DB_NAME})`);
}

// ---------- Middlewares ----------
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function requierePin(req, res, next) {
  if (req.get('x-admin-pin') !== ADMIN_PIN) {
    return res.status(401).json({ error: 'PIN incorrecto' });
  }
  next();
}

// ---------- Rutas ----------

// Menú público
app.get('/api/menu', (req, res) => res.json(MENU));

// Crear pedido (cliente) — solo retiro en el local
app.post('/api/pedidos', async (req, res) => {
  try {
    const { cliente = {}, items = [], notas = '' } = req.body || {};

    if (!cliente.nombre || !cliente.telefono)
      return res.status(400).json({ error: 'Nombre y teléfono son obligatorios' });
    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: 'El pedido está vacío' });

    // Recalculamos precios en el servidor (nunca confiar en el cliente)
    const lineas = [];
    for (const item of items) {
      const producto = MENU.find(p => p.id === item.id);
      if (!producto) continue;
      const cantidad = Math.max(1, Math.min(20, parseInt(item.cantidad, 10) || 1));
      lineas.push({
        id: producto.id,
        nombre: producto.nombre,
        precio: producto.precio,
        cantidad,
        subtotal: +(producto.precio * cantidad).toFixed(2),
      });
    }
    if (lineas.length === 0)
      return res.status(400).json({ error: 'Productos inválidos' });

    const total = +lineas.reduce((s, l) => s + l.subtotal, 0).toFixed(2);

    const pedido = {
      id: crypto.randomBytes(3).toString('hex').toUpperCase(),
      creado: new Date(),
      estado: 'pendiente',
      tipo: 'retiro',
      cliente: {
        nombre: String(cliente.nombre).slice(0, 80),
        telefono: String(cliente.telefono).slice(0, 30),
      },
      notas: String(notas).slice(0, 300),
      items: lineas,
      total,
    };

    await pedidosCol.insertOne(pedido);

    res.status(201).json({ id: pedido.id, total: pedido.total, estado: pedido.estado });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar el pedido' });
  }
});

// Listar pedidos (pizzería)
app.get('/api/pedidos', requierePin, async (req, res) => {
  try {
    const pedidos = await pedidosCol
      .find({}, { projection: { _id: 0 } })
      .sort({ creado: -1 })
      .limit(200)
      .toArray();

    res.json(pedidos.map(p => ({ ...p, creado: p.creado.toISOString() })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar pedidos' });
  }
});

// Cambiar estado (pizzería)
const ESTADOS = ['pendiente', 'preparando', 'listo', 'entregado', 'cancelado'];

app.patch('/api/pedidos/:id', requierePin, async (req, res) => {
  try {
    const { estado } = req.body || {};
    if (!ESTADOS.includes(estado))
      return res.status(400).json({ error: 'Estado inválido' });

    const resultado = await pedidosCol.findOneAndUpdate(
      { id: req.params.id },
      { $set: { estado, actualizado: new Date() } },
      { returnDocument: 'after', projection: { _id: 0 } }
    );

    if (!resultado)
      return res.status(404).json({ error: 'Pedido no encontrado' });

    res.json({ ...resultado, creado: resultado.creado.toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el pedido' });
  }
});

// Seguimiento público del cliente
app.get('/api/pedidos/:id/estado', async (req, res) => {
  try {
    const pedido = await pedidosCol.findOne(
      { id: req.params.id },
      { projection: { _id: 0, id: 1, estado: 1, total: 1 } }
    );
    if (!pedido)
      return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json(pedido);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al buscar el pedido' });
  }
});

// Atajos para el panel
app.get('/admin', (req, res) => res.redirect('/admin.html'));
app.get('/panel', (req, res) => res.redirect('/admin.html'));

// ---------- Arranque ----------
conectarDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`🍕 Servidor en http://localhost:${PORT}`);
      console.log(`   Panel admin: http://localhost:${PORT}/admin.html`);
    });
  })
  .catch(err => {
    console.error('❌ No se pudo conectar a MongoDB:', err.message);
    process.exit(1);
  });

// Cierre limpio
process.on('SIGINT', async () => {
  await client.close();
  process.exit(0);
});