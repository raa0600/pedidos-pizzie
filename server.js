// ---------- Carga de variables de entorno ----------
const path = require('path');
require('dotenv').config({
  path: path.join(__dirname, '.env'),
  override: true,
});

// ---------- Imports ----------
const express = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const { MongoClient, ObjectId } = require('mongodb');
const QRCode = require('qrcode');

// ---------- Configuración ----------
const app = express();
const PORT = process.env.PORT || 3000;
const DB_NAME = process.env.DB_NAME || 'pizzeria';
const MONGO_URI = process.env.MONGO_URI;
const JWT_SECRET = process.env.JWT_SECRET || 'cambiar-en-produccion';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '1d';
const NODE_ENV = process.env.NODE_ENV || 'development';
const IVA_RATE = 0.16;

// ---------- Credenciales del panel interno ----------
const RUBEDO_EMAIL = process.env.RUBEDO_EMAIL || 'phoenix.a@hermes.rx';
const RUBEDO_PASSWORD = process.env.RUBEDO_PASSWORD || 'Ph0en1x-A*2026!Kx9vLmQ';

if (!MONGO_URI) {
  console.error('❌ Falta MONGO_URI en el .env');
  process.exit(1);
}

// ---------- MongoDB ----------
const client = new MongoClient(MONGO_URI);
let db, tenantsCol, usuariosCol, menusCol, pedidosCol, mesasCol;

async function conectarDB() {
  await client.connect();
  db = client.db(DB_NAME);
  tenantsCol = db.collection('tenants');
  usuariosCol = db.collection('usuarios');
  menusCol = db.collection('menus');
  pedidosCol = db.collection('pedidos');
  mesasCol = db.collection('mesas');
  console.log(`✅ Conectado a MongoDB (base: ${DB_NAME})`);
}

// ---------- Middlewares base ----------
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

// ---------- Extraer tenant ----------
function extraerTenant(req, res, next) {
  let slug = null;

  if (req.params.slug) slug = req.params.slug;
  if (!slug && req.query.tenant) slug = req.query.tenant;

  if (!slug) {
    const host = req.get('host') || '';
    const hostSinPuerto = host.split(':')[0];

    const esLocal = hostSinPuerto === 'localhost' || hostSinPuerto === '127.0.0.1';
    const esRender = hostSinPuerto.includes('onrender.com');
    const esIP = /^\d+\.\d+\.\d+\.\d+$/.test(hostSinPuerto);
    const esIPv6 = hostSinPuerto.includes('[') || hostSinPuerto.includes('::');

    if (!esLocal && !esRender && !esIP && !esIPv6) {
      const partes = hostSinPuerto.split('.');
      if (partes.length >= 3) slug = partes[0];
    }
  }

  if (!slug) {
    return res.status(400).json({ error: 'Tenant no especificado' });
  }

  tenantsCol.findOne({ slug: slug.toLowerCase(), activo: true })
    .then(tenant => {
      if (!tenant) return res.status(404).json({ error: 'Restaurante no encontrado' });
      req.tenant = tenant;
      next();
    })
    .catch(err => {
      console.error(err);
      res.status(500).json({ error: 'Error al buscar el restaurante' });
    });
}

// ---------- Auth de tenant ----------
function requiereAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'No autenticado' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.tenantSlug !== req.tenant.slug) {
      return res.status(403).json({ error: 'No autorizado para este restaurante' });
    }
    req.user = payload;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Sesión expirada o inválida' });
  }
}

function requiereRol(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.rol)) {
      return res.status(403).json({ error: 'Permisos insuficientes' });
    }
    next();
  };
}

// ---------- Auth del panel interno ----------
function requiereRubedo(req, res, next) {
  const token = req.cookies.rubedo_token;
  if (!token) return res.status(401).json({ error: 'No autenticado' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.rol !== 'rubedo') {
      return res.status(403).json({ error: 'No autorizado' });
    }
    req.rubedo = payload;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Sesión expirada o inválida' });
  }
}

// ============================================================
// HELPERS
// ============================================================

// Genera una contraseña temporal solo con caracteres alfanuméricos
// (excluye caracteres confusos: 0/O, 1/l/I)
function generarPasswordTemporal() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  let pwd = '';
  for (let i = 0; i < 10; i++) {
    pwd += chars[Math.floor(Math.random() * chars.length)];
  }
  return pwd;
}

// Genera un ID corto único para variantes/extras/opciones
function generarIdCorto() {
  return crypto.randomBytes(4).toString('hex');
}

// Valida una URL de imagen
function esUrlValida(str) {
  if (!str) return true; // vacío es válido (sin imagen)
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Genera un token único para el QR de una mesa
function generarTokenMesa() {
  return crypto.randomBytes(8).toString('hex'); // 16 caracteres
}

function calcularPrecioItem(menuItem, itemPedido) {
  let precioBase = menuItem.precio || 0;

  if (menuItem.variantes && menuItem.variantes.length > 0) {
    const v = menuItem.variantes.find(x => x.id === itemPedido.varianteId);
    if (!v) throw new Error(`Variante inválida para ${menuItem.nombre}`);
    precioBase = v.precio;
  }

  let precioExtras = 0;
  const extrasAplicados = [];
  if (menuItem.extras && menuItem.extras.length > 0 && Array.isArray(itemPedido.extras)) {
    for (const ext of itemPedido.extras) {
      const extDef = menuItem.extras.find(x => x.id === ext.id);
      if (!extDef) continue;
      const cantidad = Math.max(1, Math.min(extDef.max || 1, parseInt(ext.cantidad, 10) || 1));
      precioExtras += extDef.precio * cantidad;
      extrasAplicados.push({
        id: extDef.id,
        nombre: extDef.nombre,
        precio: extDef.precio,
        cantidad,
      });
    }
  }

  let precioOpciones = 0;
  const opcionesAplicadas = [];
  if (menuItem.opciones && menuItem.opciones.length > 0 && itemPedido.opciones) {
    for (const opDef of menuItem.opciones) {
      const valorSeleccionado = itemPedido.opciones[opDef.id];

      if (opDef.tipo === 'radio') {
        const valDef = opDef.valores.find(v => v.id === valorSeleccionado);
        if (valDef) {
          precioOpciones += valDef.precio || 0;
          opcionesAplicadas.push({
            id: opDef.id,
            nombre: opDef.nombre,
            valor: valDef.nombre,
            precio: valDef.precio || 0,
          });
        } else if (opDef.requerido) {
          throw new Error(`Falta seleccionar "${opDef.nombre}" para ${menuItem.nombre}`);
        }
      } else if (opDef.tipo === 'checkbox' && valorSeleccionado === true) {
        opcionesAplicadas.push({
          id: opDef.id,
          nombre: opDef.nombre,
          valor: 'Sí',
          precio: 0,
        });
      }
    }
  }

  const precioUnitario = +(precioBase + precioExtras + precioOpciones).toFixed(2);
  return {
    precioUnitario,
    variante: menuItem.variantes?.length > 0
      ? menuItem.variantes.find(x => x.id === itemPedido.varianteId)?.nombre || null
      : null,
    extras: extrasAplicados,
    opciones: opcionesAplicadas,
  };
}

function nombreItemConOpciones(menuItem, itemPedido, calculo) {
  let nombre = menuItem.nombre;
  if (calculo.variante) nombre += ` (${calculo.variante})`;
  return nombre;
}

// ============================================================
// RATE LIMITING (en memoria)
// ============================================================

const loginAttempts = new Map(); // ip -> { count, resetAt }

function limitarIntentos(maxIntentos = 5, ventanaMinutos = 15) {
  return (req, res, next) => {
    const ip = req.ip || req.get('x-forwarded-for') || 'unknown';
    const ahora = Date.now();
    const ventanaMs = ventanaMinutos * 60 * 1000;

    let entry = loginAttempts.get(ip);
    if (!entry || entry.resetAt < ahora) {
      entry = { count: 0, resetAt: ahora + ventanaMs };
      loginAttempts.set(ip, entry);
    }

    if (entry.count >= maxIntentos) {
      const minutosRestantes = Math.ceil((entry.resetAt - ahora) / 60000);
      return res.status(429).json({
        error: `Demasiados intentos fallidos. Intenta de nuevo en ${minutosRestantes} minuto(s).`,
      });
    }

    // Interceptar la respuesta para contar intentos fallidos
    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode === 401) {
        entry.count += 1;
      } else if (res.statusCode === 200 || res.statusCode === 201) {
        loginAttempts.delete(ip);
      }
      return originalJson(body);
    };

    next();
  };
}

// Limpieza periódica del mapa (cada hora)
setInterval(() => {
  const ahora = Date.now();
  for (const [ip, entry] of loginAttempts.entries()) {
    if (entry.resetAt < ahora) loginAttempts.delete(ip);
  }
}, 60 * 60 * 1000);

// ============================================================
// AUTENTICACIÓN DE TENANT
// ============================================================

app.post('/api/:slug/auth/login', limitarIntentos(5, 15), extraerTenant, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    const usuario = await usuariosCol.findOne({
      tenantId: req.tenant._id,
      email: String(email).toLowerCase(),
      activo: true,
    });

    if (!usuario) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const ok = await bcrypt.compare(password, usuario.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = jwt.sign(
      {
        userId: String(usuario._id),
        tenantSlug: req.tenant.slug,
        rol: usuario.rol,
        nombre: usuario.nombre,
        debeCambiarPassword: usuario.debeCambiarPassword || false,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000,
    });

    await usuariosCol.updateOne(
      { _id: usuario._id },
      { $set: { ultimoLogin: new Date() } }
    );

    res.json({
      ok: true,
      usuario: {
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
        debeCambiarPassword: usuario.debeCambiarPassword || false,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

app.post('/api/:slug/auth/logout', extraerTenant, (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/:slug/auth/me', extraerTenant, requiereAuth, async (req, res) => {
  try {
    const usuario = await usuariosCol.findOne(
      { _id: new ObjectId(req.user.userId), tenantId: req.tenant._id },
      { projection: { passwordHash: 0 } }
    );

    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    res.json({
      usuario: {
        userId: String(usuario._id),
        nombre: usuario.nombre,
        email: usuario.email,
        rol: usuario.rol,
        debeCambiarPassword: usuario.debeCambiarPassword || false,
      },
      tenant: {
        slug: req.tenant.slug,
        nombre: req.tenant.nombre,
        tipo: req.tenant.tipo,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cargar usuario' });
  }
});

app.post('/api/:slug/auth/cambiar-password', extraerTenant, requiereAuth, async (req, res) => {
  try {
    const { passwordActual, passwordNueva } = req.body || {};
    if (!passwordActual || !passwordNueva) {
      return res.status(400).json({ error: 'Se requieren ambas contraseñas' });
    }
    if (passwordNueva.length < 8) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
    }

    const usuario = await usuariosCol.findOne({
      tenantId: req.tenant._id,
      _id: new ObjectId(req.user.userId),
    });

    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const ok = await bcrypt.compare(passwordActual, usuario.passwordHash);
    if (!ok) return res.status(401).json({ error: 'Contraseña actual incorrecta' });

    const hash = await bcrypt.hash(passwordNueva, 10);
    await usuariosCol.updateOne(
      { _id: usuario._id },
      { $set: { passwordHash: hash, debeCambiarPassword: false, ultimoCambioPassword: new Date() } }
    );

    const token = jwt.sign(
      {
        userId: String(usuario._id),
        tenantSlug: req.tenant.slug,
        rol: usuario.rol,
        nombre: usuario.nombre,
        debeCambiarPassword: false,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cambiar contraseña' });
  }
});

// ============================================================
// RUBEDO — LOGIN
// ============================================================

app.post('/api/rubedo/login', limitarIntentos(3, 30), async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ error: 'Email y contraseña requeridos' });
    }

    if (email.toLowerCase() !== RUBEDO_EMAIL.toLowerCase()) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    if (password !== RUBEDO_PASSWORD) {
      return res.status(401).json({ error: 'Credenciales inválidas' });
    }

    const token = jwt.sign(
      {
        rol: 'rubedo',
        email: RUBEDO_EMAIL,
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.cookie('rubedo_token', token, {
      httpOnly: true,
      secure: NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al iniciar sesión' });
  }
});

app.post('/api/rubedo/logout', (req, res) => {
  res.clearCookie('rubedo_token');
  res.json({ ok: true });
});

app.get('/api/rubedo/me', requiereRubedo, (req, res) => {
  res.json({ email: req.rubedo.email });
});

// ============================================================
// RUBEDO — TENANTS
// ============================================================

app.get('/api/rubedo/tenants', requiereRubedo, async (req, res) => {
  try {
    const tenants = await tenantsCol.find({}).sort({ creado: -1 }).toArray();

    const tenantsConMetricas = await Promise.all(tenants.map(async (t) => {
      const totalPedidos = await pedidosCol.countDocuments({ tenantId: t._id });
      const pedidosMes = await pedidosCol.countDocuments({
        tenantId: t._id,
        creado: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      });
      const usuarios = await usuariosCol.countDocuments({ tenantId: t._id, activo: true });

      return {
        ...t,
        metricas: {
          totalPedidos,
          pedidosMes,
          usuarios,
        },
      };
    }));

    res.json(tenantsConMetricas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar tenants' });
  }
});

app.get('/api/rubedo/tenants/:id', requiereRubedo, async (req, res) => {
  try {
    const tenant = await tenantsCol.findOne({ _id: new ObjectId(req.params.id) });
    if (!tenant) return res.status(404).json({ error: 'Tenant no encontrado' });

    const usuarios = await usuariosCol
      .find({ tenantId: tenant._id })
      .project({ passwordHash: 0 })
      .toArray();

    const totalPedidos = await pedidosCol.countDocuments({ tenantId: tenant._id });
    const pedidosMes = await pedidosCol.countDocuments({
      tenantId: tenant._id,
      creado: { $gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
    });

    res.json({ tenant, usuarios, metricas: { totalPedidos, pedidosMes } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al buscar tenant' });
  }
});

app.post('/api/rubedo/tenants', requiereRubedo, async (req, res) => {
  try {
    const {
      slug,
      nombre,
      tipo,
      emailOwner,
      telefono,
      plan = 'free',
      preset,
    } = req.body || {};

    if (!slug || !nombre || !tipo || !emailOwner) {
      return res.status(400).json({ error: 'Slug, nombre, tipo y email del owner son obligatorios' });
    }

    const existente = await tenantsCol.findOne({ slug: slug.toLowerCase() });
    if (existente) {
      return res.status(400).json({ error: 'El slug ya está en uso' });
    }

    const PRESETS = {
      pizzeria: {
        servicios: { retiro: true, delivery: true, dineIn: true },
        estados: [
          { id: 'pendiente', label: 'Pendiente', siguiente: 'en_horno' },
          { id: 'en_horno', label: 'En el horno', siguiente: 'listo' },
          { id: 'listo', label: 'Listo', siguiente: 'entregado' },
          { id: 'entregado', label: 'Entregado', siguiente: null },
          { id: 'cancelado', label: 'Cancelado', siguiente: null },
        ],
        tiempoEspera: 45,
        aceptaMitades: true,
        mesas: 10,
      },
      taqueria: {
        servicios: { retiro: true, delivery: true, dineIn: true },
        estados: [
          { id: 'pendiente', label: 'Pendiente', siguiente: 'preparando' },
          { id: 'preparando', label: 'Preparando', siguiente: 'listo' },
          { id: 'listo', label: 'Listo', siguiente: 'entregado' },
          { id: 'entregado', label: 'Entregado', siguiente: null },
          { id: 'cancelado', label: 'Cancelado', siguiente: null },
        ],
        tiempoEspera: 20,
        aceptaMitades: false,
        mesas: 12,
      },
      cafeteria: {
        servicios: { retiro: true, delivery: false, dineIn: true },
        estados: [
          { id: 'pendiente', label: 'Pendiente', siguiente: 'preparando' },
          { id: 'preparando', label: 'Preparando', siguiente: 'listo' },
          { id: 'listo', label: 'Listo', siguiente: 'entregado' },
          { id: 'entregado', label: 'Entregado', siguiente: null },
          { id: 'cancelado', label: 'Cancelado', siguiente: null },
        ],
        tiempoEspera: 15,
        aceptaMitades: false,
        mesas: 8,
      },
    };

    const presetData = PRESETS[preset] || PRESETS.pizzeria;

    const passwordTemporal = generarPasswordTemporal();
    const hash = await bcrypt.hash(passwordTemporal, 10);

    const tenantDoc = {
      slug: slug.toLowerCase(),
      nombre,
      tipo,
      email: emailOwner,
      telefono: telefono || '',
      plan,
      activo: true,
      creado: new Date(),
      configuracion: {
        servicios: presetData.servicios,
        estados: presetData.estados,
        tiempoEspera: presetData.tiempoEspera,
        colorAcento: '#ff4d00',
        logoUrl: null,
        aceptaMitades: presetData.aceptaMitades,
        delivery: {
          pedidoMinimo: 100,
          zonas: [
            { id: 'centro', nombre: 'Centro', costo: 25 },
            { id: 'norte', nombre: 'Zona Norte', costo: 35 },
          ],
        },
      },
      limites: {
        maxPedidosMes: null,
        maxUsuarios: null,
        maxMesas: null,
      },
    };

    const resultTenant = await tenantsCol.insertOne(tenantDoc);
    const tenantId = resultTenant.insertedId;

    await usuariosCol.insertOne({
      tenantId,
      email: emailOwner.toLowerCase(),
      passwordHash: hash,
      nombre: 'Owner',
      rol: 'owner',
      activo: true,
      debeCambiarPassword: true,
      ultimoLogin: null,
      creado: new Date(),
    });

    if (presetData.mesas > 0) {
      const mesasDocs = [];
      for (let i = 1; i <= presetData.mesas; i++) {
        mesasDocs.push({
          tenantId,
          numero: i,
          estado: 'libre',
          meseroId: null,
          comensales: 0,
          pedidosActivos: [],
          creada: new Date(),
          actualizada: new Date(),
        });
      }
      await mesasCol.insertMany(mesasDocs);
    }

    res.status(201).json({
      ok: true,
      tenant: { ...tenantDoc, _id: tenantId },
      passwordTemporal,
      ownerEmail: emailOwner,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear tenant' });
  }
});

app.put('/api/rubedo/tenants/:id', requiereRubedo, async (req, res) => {
  try {
    const { nombre, telefono, plan, activo, configuracion } = req.body || {};

    const update = {};
    if (nombre !== undefined) update.nombre = nombre;
    if (telefono !== undefined) update.telefono = telefono;
    if (plan !== undefined) update.plan = plan;
    if (activo !== undefined) update.activo = activo;
    if (configuracion !== undefined) update.configuracion = configuracion;

    const result = await tenantsCol.findOneAndUpdate(
      { _id: new ObjectId(req.params.id) },
      { $set: update },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ error: 'Tenant no encontrado' });

    res.json({ ok: true, tenant: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar tenant' });
  }
});

app.post('/api/rubedo/tenants/:id/reset-password', requiereRubedo, async (req, res) => {
  try {
    const { emailOwner } = req.body || {};

    const usuario = await usuariosCol.findOne({
      tenantId: new ObjectId(req.params.id),
      email: emailOwner?.toLowerCase(),
      rol: 'owner',
    });

    if (!usuario) return res.status(404).json({ error: 'Owner no encontrado' });

    const passwordTemporal = generarPasswordTemporal();
    const hash = await bcrypt.hash(passwordTemporal, 10);

    await usuariosCol.updateOne(
      { _id: usuario._id },
      { $set: { passwordHash: hash, debeCambiarPassword: true } }
    );

    res.json({ ok: true, passwordTemporal, emailOwner: usuario.email });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al resetear contraseña' });
  }
});

app.post('/api/rubedo/tenants/:id/impersonar', requiereRubedo, async (req, res) => {
  try {
    const tenant = await tenantsCol.findOne({ _id: new ObjectId(req.params.id) });
    if (!tenant) return res.status(404).json({ error: 'Tenant no encontrado' });

    const owner = await usuariosCol.findOne({
      tenantId: tenant._id,
      rol: 'owner',
    });

    if (!owner) return res.status(404).json({ error: 'Owner no encontrado' });

    const token = jwt.sign(
      {
        userId: String(owner._id),
        tenantSlug: tenant.slug,
        rol: owner.rol,
        nombre: owner.nombre,
        debeCambiarPassword: false,
        impersonadoPor: RUBEDO_EMAIL,
      },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 2 * 60 * 60 * 1000,
    });

    res.json({ ok: true, tenantSlug: tenant.slug });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al impersonar' });
  }
});

// ============================================================
// BACKUP
// ============================================================

app.get('/api/rubedo/backup', async (req, res) => {
  try {
    // Autorizar por cookie de Rubedo O por token en query
    let autorizado = false;

    const BACKUP_TOKEN = process.env.BACKUP_TOKEN;
    const tokenQuery = req.query.token;
    if (BACKUP_TOKEN && tokenQuery && tokenQuery === BACKUP_TOKEN) {
      autorizado = true;
    }

    if (!autorizado) {
      const cookieToken = req.cookies.rubedo_token;
      if (cookieToken) {
        try {
          const payload = jwt.verify(cookieToken, JWT_SECRET);
          if (payload.rol === 'rubedo') autorizado = true;
        } catch { }
      }
    }

    if (!autorizado) {
      return res.status(401).json({ error: 'No autorizado' });
    }

    // Generar backup completo
    const backup = {
      version: 1,
      generado: new Date().toISOString(),
      db: DB_NAME,
      datos: {
        tenants: await tenantsCol.find({}).toArray(),
        usuarios: await usuariosCol.find({}).toArray(),
        menus: await menusCol.find({}).toArray(),
        pedidos: await pedidosCol.find({}).toArray(),
        mesas: await mesasCol.find({}).toArray(),
      },
    };

    // Conteos
    backup.conteos = {};
    for (const [k, v] of Object.entries(backup.datos)) {
      backup.conteos[k] = v.length;
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const nombreArchivo = `hermes-backup-${timestamp}.json`;

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
    res.send(JSON.stringify(backup, null, 2));

    console.log(`📦 Backup generado: ${nombreArchivo}`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al generar backup' });
  }
});

// ============================================================
// CONFIGURACIÓN PÚBLICA DEL TENANT
// ============================================================

app.get('/api/:slug/config', extraerTenant, (req, res) => {
  const t = req.tenant;
  const c = t.configuracion || {};
  res.json({
    slug: t.slug,
    nombre: t.nombre,
    tipo: t.tipo,
    configuracion: {
      servicios: c.servicios || { retiro: true, delivery: false, dineIn: false },
      estados: c.estados || [
        { id: 'pendiente', label: 'Pendiente', siguiente: 'preparando' },
        { id: 'preparando', label: 'Preparando', siguiente: 'listo' },
        { id: 'listo', label: 'Listo', siguiente: 'entregado' },
        { id: 'entregado', label: 'Entregado', siguiente: null },
      ],
      tiempoEspera: c.tiempoEspera ?? 30,
      colorAcento: c.colorAcento ?? '#ff4d00',
      logoUrl: c.logoUrl ?? null,
      aceptaMitades: c.aceptaMitades ?? false,
      delivery: c.delivery || { pedidoMinimo: 0, zonas: [] },
    },
  });
});

// ============================================================
// MENÚ (público)
// ============================================================

app.get('/api/:slug/menu', extraerTenant, async (req, res) => {
  try {
    const items = await menusCol
      .find({
        tenantId: req.tenant._id,
        disponible: true,
        eliminado: { $ne: true },
      })
      .sort({ categoria: 1, orden: 1 })
      .project({ tenantId: 0, disponible: 0, creado: 0, eliminado: 0 })
      .toArray();
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cargar el menú' });
  }
});

// ============================================================
// GESTIÓN (solo owner)
// ============================================================

// --- MENÚ ---

// Lista completa (incluye no disponibles, excluye eliminados)
app.get('/api/:slug/gestion/menu', extraerTenant, requiereAuth, requiereRol('owner'), async (req, res) => {
  try {
    const items = await menusCol
      .find({
        tenantId: req.tenant._id,
        eliminado: { $ne: true },
      })
      .sort({ categoria: 1, orden: 1 })
      .project({ tenantId: 0, creado: 0, eliminado: 0 })
      .toArray();

    const categorias = [...new Set(items.map(i => i.categoria))].sort();
    res.json({ items, categorias });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cargar el menú de gestión' });
  }
});

// Crear platillo
app.post('/api/:slug/gestion/menu', extraerTenant, requiereAuth, requiereRol('owner'), async (req, res) => {
  try {
    const {
      nombre,
      categoria,
      descripcion = '',
      imagen = null,
      precio = null,
      variantes = [],
      extras = [],
      opciones = [],
      disponible = true,
      orden = 1,
    } = req.body || {};

    if (!nombre || !categoria) {
      return res.status(400).json({ error: 'Nombre y categoría son obligatorios' });
    }
    if (!esUrlValida(imagen)) {
      return res.status(400).json({ error: 'La URL de la imagen no es válida' });
    }

    // Validar estructura
    if (variantes.length > 0) {
      for (const v of variantes) {
        if (!v.id || !v.nombre || typeof v.precio !== 'number') {
          return res.status(400).json({ error: 'Cada variante debe tener id, nombre y precio' });
        }
      }
    } else if (precio === null || typeof precio !== 'number') {
      return res.status(400).json({ error: 'Debes indicar un precio o al menos una variante' });
    }

    const doc = {
      tenantId: req.tenant._id,
      categoria: String(categoria).slice(0, 50),
      nombre: String(nombre).slice(0, 80),
      descripcion: String(descripcion).slice(0, 300),
      imagen: imagen ? String(imagen).slice(0, 500) : null,
      precio: variantes.length > 0 ? null : +Number(precio).toFixed(2),
      variantes: variantes.map(v => ({
        id: String(v.id).slice(0, 30),
        nombre: String(v.nombre).slice(0, 40),
        precio: +Number(v.precio).toFixed(2),
      })),
      extras: extras.map(e => ({
        id: String(e.id).slice(0, 30),
        nombre: String(e.nombre).slice(0, 40),
        precio: +Number(e.precio).toFixed(2),
        max: Math.max(1, Math.min(10, parseInt(e.max, 10) || 1)),
      })),
      opciones: opciones.map(o => ({
        id: String(o.id).slice(0, 30),
        nombre: String(o.nombre).slice(0, 60),
        tipo: o.tipo === 'checkbox' ? 'checkbox' : 'radio',
        requerido: !!o.requerido,
        valores: Array.isArray(o.valores)
          ? o.valores.map(v => ({
            id: String(v.id).slice(0, 30),
            nombre: String(v.nombre).slice(0, 40),
            precio: +Number(v.precio || 0).toFixed(2),
          }))
          : [],
      })),
      disponible: !!disponible,
      orden: Math.max(0, parseInt(orden, 10) || 1),
      creado: new Date(),
      actualizado: new Date(),
    };

    const result = await menusCol.insertOne(doc);

    res.status(201).json({
      ok: true,
      item: { ...doc, _id: result.insertedId },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear platillo' });
  }
});

// Actualizar platillo
app.put('/api/:slug/gestion/menu/:id', extraerTenant, requiereAuth, requiereRol('owner'), async (req, res) => {
  try {
    const {
      nombre,
      categoria,
      descripcion = '',
      imagen = null,
      precio = null,
      variantes = [],
      extras = [],
      opciones = [],
      disponible = true,
      orden = 1,
    } = req.body || {};

    if (!nombre || !categoria) {
      return res.status(400).json({ error: 'Nombre y categoría son obligatorios' });
    }
    if (!esUrlValida(imagen)) {
      return res.status(400).json({ error: 'La URL de la imagen no es válida' });
    }

    if (variantes.length > 0) {
      for (const v of variantes) {
        if (!v.id || !v.nombre || typeof v.precio !== 'number') {
          return res.status(400).json({ error: 'Cada variante debe tener id, nombre y precio' });
        }
      }
    } else if (precio === null || typeof precio !== 'number') {
      return res.status(400).json({ error: 'Debes indicar un precio o al menos una variante' });
    }

    const update = {
      categoria: String(categoria).slice(0, 50),
      nombre: String(nombre).slice(0, 80),
      descripcion: String(descripcion).slice(0, 300),
      imagen: imagen ? String(imagen).slice(0, 500) : null,
      precio: variantes.length > 0 ? null : +Number(precio).toFixed(2),
      variantes: variantes.map(v => ({
        id: String(v.id).slice(0, 30),
        nombre: String(v.nombre).slice(0, 40),
        precio: +Number(v.precio).toFixed(2),
      })),
      extras: extras.map(e => ({
        id: String(e.id).slice(0, 30),
        nombre: String(e.nombre).slice(0, 40),
        precio: +Number(e.precio).toFixed(2),
        max: Math.max(1, Math.min(10, parseInt(e.max, 10) || 1)),
      })),
      opciones: opciones.map(o => ({
        id: String(o.id).slice(0, 30),
        nombre: String(o.nombre).slice(0, 60),
        tipo: o.tipo === 'checkbox' ? 'checkbox' : 'radio',
        requerido: !!o.requerido,
        valores: Array.isArray(o.valores)
          ? o.valores.map(v => ({
            id: String(v.id).slice(0, 30),
            nombre: String(v.nombre).slice(0, 40),
            precio: +Number(v.precio || 0).toFixed(2),
          }))
          : [],
      })),
      disponible: !!disponible,
      orden: Math.max(0, parseInt(orden, 10) || 1),
      actualizado: new Date(),
    };

    const result = await menusCol.findOneAndUpdate(
      { tenantId: req.tenant._id, _id: new ObjectId(req.params.id) },
      { $set: update },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ error: 'Platillo no encontrado' });

    res.json({ ok: true, item: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar platillo' });
  }
});

// Soft delete platillo
app.delete('/api/:slug/gestion/menu/:id', extraerTenant, requiereAuth, requiereRol('owner'), async (req, res) => {
  try {
    const result = await menusCol.findOneAndUpdate(
      { tenantId: req.tenant._id, _id: new ObjectId(req.params.id) },
      { $set: { eliminado: true, disponible: false, actualizado: new Date() } },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ error: 'Platillo no encontrado' });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al eliminar platillo' });
  }
});

// --- USUARIOS ---

app.get('/api/:slug/gestion/usuarios', extraerTenant, requiereAuth, requiereRol('owner'), async (req, res) => {
  try {
    const usuarios = await usuariosCol
      .find({ tenantId: req.tenant._id })
      .project({ passwordHash: 0 })
      .sort({ creado: 1 })
      .toArray();

    res.json(usuarios);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar usuarios' });
  }
});

app.post('/api/:slug/gestion/usuarios', extraerTenant, requiereAuth, requiereRol('owner'), async (req, res) => {
  try {
    const { email, nombre, rol } = req.body || {};

    if (!email || !nombre || !rol) {
      return res.status(400).json({ error: 'Email, nombre y rol son obligatorios' });
    }
    if (!['owner', 'cocina', 'caja', 'mesero'].includes(rol)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    // Validar que el email no exista en este tenant
    const existente = await usuariosCol.findOne({
      tenantId: req.tenant._id,
      email: email.toLowerCase(),
    });
    if (existente) {
      return res.status(400).json({ error: 'Ya existe un usuario con ese email' });
    }

    const passwordTemporal = generarPasswordTemporal();
    const hash = await bcrypt.hash(passwordTemporal, 10);

    const nuevoUsuario = {
      tenantId: req.tenant._id,
      email: email.toLowerCase(),
      passwordHash: hash,
      nombre: String(nombre).slice(0, 80),
      rol,
      activo: true,
      debeCambiarPassword: true,
      ultimoLogin: null,
      creado: new Date(),
    };

    const result = await usuariosCol.insertOne(nuevoUsuario);

    res.status(201).json({
      ok: true,
      usuario: {
        _id: result.insertedId,
        email: nuevoUsuario.email,
        nombre: nuevoUsuario.nombre,
        rol: nuevoUsuario.rol,
        activo: true,
      },
      passwordTemporal,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al crear usuario' });
  }
});

app.put('/api/:slug/gestion/usuarios/:id', extraerTenant, requiereAuth, requiereRol('owner'), async (req, res) => {
  try {
    const { nombre, rol, activo } = req.body || {};

    const update = {};
    if (nombre !== undefined) update.nombre = String(nombre).slice(0, 80);
    if (rol !== undefined) {
      if (!['owner', 'cocina', 'caja', 'mesero'].includes(rol)) {
        return res.status(400).json({ error: 'Rol inválido' });
      }
      update.rol = rol;
    }
    if (activo !== undefined) update.activo = !!activo;

    const result = await usuariosCol.findOneAndUpdate(
      { tenantId: req.tenant._id, _id: new ObjectId(req.params.id) },
      { $set: update },
      { returnDocument: 'after', projection: { passwordHash: 0 } }
    );

    if (!result) return res.status(404).json({ error: 'Usuario no encontrado' });

    res.json({ ok: true, usuario: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar usuario' });
  }
});

app.post('/api/:slug/gestion/usuarios/:id/reset-password', extraerTenant, requiereAuth, requiereRol('owner'), async (req, res) => {
  try {
    const usuario = await usuariosCol.findOne({
      tenantId: req.tenant._id,
      _id: new ObjectId(req.params.id),
    });

    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const passwordTemporal = generarPasswordTemporal();
    const hash = await bcrypt.hash(passwordTemporal, 10);

    await usuariosCol.updateOne(
      { _id: usuario._id },
      { $set: { passwordHash: hash, debeCambiarPassword: true } }
    );

    res.json({ ok: true, passwordTemporal, email: usuario.email, nombre: usuario.nombre });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al resetear contraseña' });
  }
});

// --- CONFIGURACIÓN ---

app.get('/api/:slug/gestion/config', extraerTenant, requiereAuth, requiereRol('owner'), (req, res) => {
  const t = req.tenant;
  const c = t.configuracion || {};
  res.json({
    nombre: t.nombre,
    telefono: t.telefono || '',
    configuracion: {
      servicios: c.servicios || { retiro: true, delivery: false, dineIn: false },
      tiempoEspera: c.tiempoEspera ?? 30,
      colorAcento: c.colorAcento ?? '#ff4d00',
      aceptaMitades: c.aceptaMitades ?? false,
      delivery: c.delivery || { pedidoMinimo: 0, zonas: [] },
    },
  });
});

app.put('/api/:slug/gestion/config', extraerTenant, requiereAuth, requiereRol('owner'), async (req, res) => {
  try {
    const { nombre, telefono, configuracion } = req.body || {};

    const update = {};
    if (nombre !== undefined) update.nombre = String(nombre).slice(0, 80);
    if (telefono !== undefined) update.telefono = String(telefono).slice(0, 30);
    if (configuracion) {
      // Preservar estados (no editables desde el panel)
      const estadosActuales = req.tenant.configuracion?.estados || [];

      update['configuracion.servicios'] = {
        retiro: !!configuracion.servicios?.retiro,
        delivery: !!configuracion.servicios?.delivery,
        dineIn: !!configuracion.servicios?.dineIn,
      };
      update['configuracion.tiempoEspera'] = Math.max(5, Math.min(180, parseInt(configuracion.tiempoEspera, 10) || 30));
      update['configuracion.colorAcento'] = String(configuracion.colorAcento || '#ff4d00').slice(0, 20);
      update['configuracion.aceptaMitades'] = !!configuracion.aceptaMitades;

      if (configuracion.delivery) {
        const zonas = Array.isArray(configuracion.delivery.zonas)
          ? configuracion.delivery.zonas
            .filter(z => z.nombre && typeof z.costo !== 'undefined')
            .map((z, i) => ({
              id: String(z.id || `z${i + 1}`).slice(0, 30),
              nombre: String(z.nombre).slice(0, 40),
              costo: +Number(z.costo || 0).toFixed(2),
            }))
          : [];

        update['configuracion.delivery'] = {
          pedidoMinimo: +Number(configuracion.delivery.pedidoMinimo || 0).toFixed(2),
          zonas,
        };
      }

      // Mantener estados como estaban (no se editan aquí)
      update['configuracion.estados'] = estadosActuales;
    }

    const result = await tenantsCol.findOneAndUpdate(
      { _id: req.tenant._id },
      { $set: update },
      { returnDocument: 'after' }
    );

    res.json({ ok: true, tenant: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar configuración' });
  }
});

// --- MI CUENTA (el owner cambia sus propios datos) ---

app.put('/api/:slug/gestion/mi-cuenta', extraerTenant, requiereAuth, requiereRol('owner'), async (req, res) => {
  try {
    const { nombre, email, passwordActual, passwordNueva } = req.body || {};

    const usuario = await usuariosCol.findOne({
      tenantId: req.tenant._id,
      _id: new ObjectId(req.user.userId),
    });

    if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });

    const update = {};
    let cambioEmail = false;
    let cambioNombre = false;

    // Cambio de nombre
    if (nombre !== undefined) {
      const nombreLimpio = String(nombre).trim().slice(0, 80);
      if (!nombreLimpio) {
        return res.status(400).json({ error: 'El nombre no puede estar vacío' });
      }
      if (nombreLimpio !== usuario.nombre) {
        update.nombre = nombreLimpio;
        cambioNombre = true;
      }
    }

    // Cambio de email
    if (email !== undefined) {
      const emailLimpio = String(email).trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailLimpio)) {
        return res.status(400).json({ error: 'Email inválido' });
      }
      if (emailLimpio !== usuario.email) {
        const existente = await usuariosCol.findOne({
          tenantId: req.tenant._id,
          email: emailLimpio,
          _id: { $ne: usuario._id },
        });
        if (existente) {
          return res.status(400).json({ error: 'Ese email ya está en uso por otro usuario' });
        }
        update.email = emailLimpio;
        cambioEmail = true;
      }
    }

    // Cambio de contraseña
    if (passwordNueva) {
      if (!passwordActual) {
        return res.status(400).json({ error: 'Debes ingresar tu contraseña actual' });
      }
      if (String(passwordNueva).length < 8) {
        return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres' });
      }
      const ok = await bcrypt.compare(passwordActual, usuario.passwordHash);
      if (!ok) {
        return res.status(401).json({ error: 'Contraseña actual incorrecta' });
      }
      update.passwordHash = await bcrypt.hash(passwordNueva, 10);
      update.debeCambiarPassword = false;
      update.ultimoCambioPassword = new Date();
    }

    if (Object.keys(update).length === 0) {
      return res.json({ ok: true, sinCambios: true });
    }

    await usuariosCol.updateOne({ _id: usuario._id }, { $set: update });

    // Regenerar el token con los nuevos datos
    const nuevoNombre = update.nombre || usuario.nombre;
    const nuevoEmail = update.email || usuario.email;

    const token = jwt.sign(
      {
        userId: String(usuario._id),
        tenantSlug: req.tenant.slug,
        rol: usuario.rol,
        nombre: nuevoNombre,
        email: nuevoEmail,
        debeCambiarPassword: false,
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    res.cookie('token', token, {
      httpOnly: true,
      secure: NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.json({
      ok: true,
      usuario: {
        nombre: nuevoNombre,
        email: nuevoEmail,
      },
      cambioEmail,
      cambioNombre,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar tu cuenta' });
  }
});

// ============================================================
// MESAS
// ============================================================

app.get('/api/:slug/mesas', extraerTenant, requiereAuth, async (req, res) => {
  try {
    const mesas = await mesasCol
      .find({ tenantId: req.tenant._id })
      .sort({ numero: 1 })
      .project({ tenantId: 0 })
      .toArray();
    res.json(mesas);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar mesas' });
  }
});

app.get('/api/:slug/mesas/:numero', extraerTenant, async (req, res) => {
  try {
    const numero = parseInt(req.params.numero, 10);
    const mesa = await mesasCol.findOne(
      { tenantId: req.tenant._id, numero },
      { projection: { tenantId: 0 } }
    );
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });
    res.json(mesa);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al buscar mesa' });
  }
});

app.patch('/api/:slug/mesas/:numero/cerrar', extraerTenant, requiereAuth, async (req, res) => {
  try {
    const numero = parseInt(req.params.numero, 10);
    const tenantId = req.tenant._id;

    const mesa = await mesasCol.findOne({ tenantId, numero });
    if (!mesa) return res.status(404).json({ error: 'Mesa no encontrada' });

    if (mesa.estado === 'libre' && (!mesa.pedidosActivos || mesa.pedidosActivos.length === 0)) {
      return res.status(400).json({ error: 'La mesa ya está libre' });
    }

    const estadosTenant = req.tenant.configuracion?.estados || [];
    const estadoFinal = estadosTenant.find(e => e.id === 'entregado')?.id || 'entregado';

    const pedidosActivos = await pedidosCol
      .find({
        tenantId,
        'mesa.numero': numero,
        tipoServicio: 'dineIn',
        estado: { $nin: [estadoFinal, 'cancelado'] },
      })
      .toArray();

    if (pedidosActivos.length === 0) {
      await mesasCol.updateOne(
        { tenantId, numero },
        {
          $set: {
            estado: 'libre',
            meseroId: null,
            comensales: 0,
            pedidosActivos: [],
            actualizada: new Date(),
          },
        }
      );
      return res.json({
        ok: true,
        mesa: numero,
        pedidosCerrados: 0,
        total: 0,
      });
    }

    const idsPedidos = pedidosActivos.map(p => p.id);
    const totalMesa = +pedidosActivos.reduce((s, p) => s + (p.total || 0), 0).toFixed(2);

    await pedidosCol.updateMany(
      { tenantId, id: { $in: idsPedidos } },
      {
        $set: {
          estado: estadoFinal,
          actualizado: new Date(),
          cerradoMesa: new Date(),
        },
      }
    );

    await mesasCol.updateOne(
      { tenantId, numero },
      {
        $set: {
          estado: 'libre',
          meseroId: null,
          comensales: 0,
          pedidosActivos: [],
          actualizada: new Date(),
        },
      }
    );

    res.json({
      ok: true,
      mesa: numero,
      pedidosCerrados: idsPedidos.length,
      idsPedidos,
      total: totalMesa,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al cerrar la mesa' });
  }
});

app.get('/api/:slug/mesas/:numero/qr.svg', extraerTenant, async (req, res) => {
  try {
    const numero = parseInt(req.params.numero, 10);
    let mesa = await mesasCol.findOne({ tenantId: req.tenant._id, numero });
    if (!mesa) return res.status(404).send('Mesa no encontrada');

    // Si no tiene token, generarlo
    if (!mesa.tokenQR) {
      mesa.tokenQR = generarTokenMesa();
      await mesasCol.updateOne({ _id: mesa._id }, { $set: { tokenQR: mesa.tokenQR } });
    }

    const proto = req.get('x-forwarded-proto') || req.protocol;
    const host = req.get('host');
    const url = `${proto}://${host}/${req.tenant.slug}/mesa/${numero}?t=${mesa.tokenQR}`;

    const svg = await QRCode.toString(url, {
      type: 'svg',
      margin: 1,
      width: 300,
      color: { dark: '#0a0a0a', light: '#ffffff' },
    });

    res.type('image/svg+xml').send(svg);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al generar QR');
  }
});

app.get('/:slug/mesas/imprimir-qr', extraerTenant, async (req, res) => {
  try {
    const mesas = await mesasCol
      .find({ tenantId: req.tenant._id })
      .sort({ numero: 1 })
      .toArray();

    // Asegurar que todas las mesas tengan token
    for (const m of mesas) {
      if (!m.tokenQR) {
        m.tokenQR = generarTokenMesa();
        await mesasCol.updateOne({ _id: m._id }, { $set: { tokenQR: m.tokenQR } });
      }
    }

    const proto = req.get('x-forwarded-proto') || req.protocol;
    const host = req.get('host');
    const baseUrl = `${proto}://${host}`;

    const qrs = await Promise.all(mesas.map(async (m) => {
      const url = `${baseUrl}/${req.tenant.slug}/mesa/${m.numero}?t=${m.tokenQR}`;
      const svg = await QRCode.toString(url, {
        type: 'svg',
        margin: 1,
        width: 280,
        color: { dark: '#0a0a0a', light: '#ffffff' },
      });
      return { numero: m.numero, svg, url };
    }));

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <title>QR Mesas · ${req.tenant.nombre}</title>
        <style>
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; background: #fff; color: #0a0a0a; padding: 40px 24px; }
          header { max-width: 1100px; margin: 0 auto 40px; padding-bottom: 20px; border-bottom: 2px solid #0a0a0a; display: flex; justify-content: space-between; align-items: baseline; }
          header h1 { font-size: 1.5rem; letter-spacing: -0.02em; }
          header .sub { font-size: 0.75rem; letter-spacing: 0.15em; text-transform: uppercase; color: #666; }
          .info { max-width: 1100px; margin: 0 auto 30px; padding: 16px 20px; background: #f2f2f2; border-left: 4px solid #ff4d00; font-size: 0.85rem; line-height: 1.5; }
          .grid { max-width: 1100px; margin: 0 auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 24px; }
          .qr-card { border: 1px solid #ccc; padding: 20px; display: flex; flex-direction: column; align-items: center; gap: 12px; page-break-inside: avoid; }
          .qr-card .numero { font-size: 2rem; font-weight: 700; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
          .qr-card .label { font-size: 0.7rem; letter-spacing: 0.15em; text-transform: uppercase; color: #666; }
          .qr-card svg { width: 100%; height: auto; max-width: 220px; }
          .qr-card .instruccion { font-size: 0.7rem; color: #666; text-align: center; line-height: 1.4; }
          .acciones { max-width: 1100px; margin: 0 auto 30px; display: flex; gap: 12px; }
          .btn-imprimir { padding: 12px 24px; background: #0a0a0a; color: #fff; border: none; font-size: 0.8rem; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; cursor: pointer; }
          @media print { .acciones { display: none; } .info { display: none; } body { padding: 0; } header { margin-bottom: 20px; } }
        </style>
      </head>
      <body>
        <header>
          <h1>${req.tenant.nombre} · Mesas</h1>
          <span class="sub">Hermes · ${qrs.length} mesas</span>
        </header>
        <div class="acciones">
          <button class="btn-imprimir" onclick="window.print()">Imprimir</button>
        </div>
        <div class="info">
          <strong>Instrucciones:</strong> Imprime esta página y coloca cada QR en su mesa.
          El cliente lo escanea con la cámara del celular y llega directo al menú con la mesa asignada.
        </div>
        <div class="grid">
          ${qrs.map(q => `
            <div class="qr-card">
              <span class="label">Mesa</span>
              <span class="numero">${q.numero}</span>
              ${q.svg}
              <span class="instruccion">Escanea para ordenar<br>Cada persona puede pedir desde su celular</span>
            </div>
          `).join('')}
        </div>
      </body>
      </html>
    `;

    res.type('text/html').send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al generar los QR');
  }
});

// ============================================================
// PEDIDOS
// ============================================================

app.post('/api/:slug/pedidos', extraerTenant, async (req, res) => {
  try {
    const {
      cliente = {},
      items = [],
      notas = '',
      tipoServicio = 'retiro',
      direccion = null,
      zonaId = null,
      numeroMesa = null,
      meseroId = null,
    } = req.body || {};

    if (!cliente.nombre) {
      return res.status(400).json({ error: 'El nombre es obligatorio' });
    }
    if (tipoServicio !== 'dineIn' && !cliente.telefono) {
      return res.status(400).json({ error: 'El teléfono es obligatorio' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'El pedido está vacío' });
    }

    const servicios = req.tenant.configuracion?.servicios || {};
    if (!servicios[tipoServicio]) {
      return res.status(400).json({ error: 'Tipo de servicio no disponible' });
    }
    if (tipoServicio === 'delivery' && !direccion) {
      return res.status(400).json({ error: 'Se requiere dirección para delivery' });
    }
    if (tipoServicio === 'dineIn' && !numeroMesa) {
      return res.status(400).json({ error: 'Se requiere número de mesa' });
    }
    // Validar token del QR para pedidos en mesa
    if (tipoServicio === 'dineIn') {
      const mesaToken = req.body.mesaToken;
      if (!mesaToken) {
        return res.status(403).json({ error: 'Solo se puede ordenar en mesa desde el código QR de la mesa' });
      }
      const mesaValida = await mesasCol.findOne({
        tenantId: req.tenant._id,
        numero: parseInt(numeroMesa, 10),
        tokenQR: mesaToken,
      });
      if (!mesaValida) {
        return res.status(403).json({ error: 'Código QR inválido. Escanea el QR de tu mesa.' });
      }
    }
    const menus = await menusCol
      .find({
        tenantId: req.tenant._id,
        disponible: true,
        eliminado: { $ne: true },
      })
      .toArray();

    const lineas = [];
    for (const item of items) {
      const cantidad = Math.max(1, Math.min(50, parseInt(item.cantidad, 10) || 1));

      if (typeof item.id === 'string' && item.id.includes('+')) {
        if (!req.tenant.configuracion?.aceptaMitades) continue;
        const [a, b] = item.id.split('+');
        const p1 = menus.find(m => m._id.toString() === a);
        const p2 = menus.find(m => m._id.toString() === b);
        if (!p1 || !p2 || a === b) continue;

        const precio = +((p1.precio + p2.precio) / 2).toFixed(2);
        lineas.push({
          menuId: null,
          nombre: `Mitad ${p1.nombre} / Mitad ${p2.nombre}`,
          precioUnitario: precio,
          cantidad,
          subtotal: +(precio * cantidad).toFixed(2),
          variante: null,
          extras: [],
          opciones: [],
          notas: item.notas || '',
        });
        continue;
      }

      const menuItem = menus.find(m => m._id.toString() === item.id);
      if (!menuItem) continue;

      let calculo;
      try {
        calculo = calcularPrecioItem(menuItem, item);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }

      lineas.push({
        menuId: menuItem._id.toString(),
        nombre: nombreItemConOpciones(menuItem, item, calculo),
        precioUnitario: calculo.precioUnitario,
        variante: calculo.variante,
        extras: calculo.extras,
        opciones: calculo.opciones,
        cantidad,
        subtotal: +(calculo.precioUnitario * cantidad).toFixed(2),
        notas: String(item.notas || '').slice(0, 200),
      });
    }

    if (lineas.length === 0) {
      return res.status(400).json({ error: 'Productos inválidos' });
    }

    const subtotal = +lineas.reduce((s, l) => s + l.subtotal, 0).toFixed(2);
    const iva = +(subtotal * IVA_RATE).toFixed(2);

    let costoEnvio = 0;
    let zonaNombre = null;
    if (tipoServicio === 'delivery') {
      const zonas = req.tenant.configuracion?.delivery?.zonas || [];
      const zona = zonas.find(z => z.id === zonaId);
      if (zona) {
        costoEnvio = zona.costo || 0;
        zonaNombre = zona.nombre;
      }
      const minimo = req.tenant.configuracion?.delivery?.pedidoMinimo || 0;
      if (minimo > 0 && subtotal < minimo) {
        return res.status(400).json({ error: `El pedido mínimo para delivery es $${minimo}` });
      }
    }

    const total = +(subtotal + iva + costoEnvio).toFixed(2);

    let mesaInfo = null;
    if (tipoServicio === 'dineIn' && numeroMesa) {
      const mesa = await mesasCol.findOne({
        tenantId: req.tenant._id,
        numero: parseInt(numeroMesa, 10),
        tokenQR: req.body.mesaToken,
      });
      if (!mesa) return res.status(400).json({ error: 'Mesa no encontrada' });
      mesaInfo = { numero: mesa.numero, id: mesa._id.toString() };
    }

    const pedido = {
      tenantId: req.tenant._id,
      id: crypto.randomBytes(3).toString('hex').toUpperCase(),
      creado: new Date(),
      actualizado: new Date(),
      estado: req.tenant.configuracion?.estados?.[0]?.id || 'pendiente',
      tipoServicio,
      mesa: mesaInfo,
      meseroId: meseroId || null,
      direccion: tipoServicio === 'delivery' ? String(direccion).slice(0, 200) : null,
      zonaDelivery: zonaNombre,
      costoEnvio,
      cliente: {
        nombre: String(cliente.nombre).slice(0, 80),
        telefono: String(cliente.telefono || '').slice(0, 30),
      },
      notas: String(notas).slice(0, 300),
      items: lineas,
      subtotal,
      iva,
      total,
    };

    await pedidosCol.insertOne(pedido);

    if (tipoServicio === 'dineIn' && mesaInfo) {
      await mesasCol.updateOne(
        { _id: new ObjectId(mesaInfo.id) },
        {
          $set: { estado: 'ocupada', actualizada: new Date() },
          $addToSet: { pedidosActivos: pedido.id },
        }
      );
    }

    res.status(201).json({
      id: pedido.id,
      subtotal: pedido.subtotal,
      iva: pedido.iva,
      costoEnvio: pedido.costoEnvio,
      total: pedido.total,
      estado: pedido.estado,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al guardar el pedido' });
  }
});

app.get('/api/:slug/pedidos', extraerTenant, requiereAuth, async (req, res) => {
  try {
    const { tipoServicio, estado } = req.query;
    const filtro = { tenantId: req.tenant._id };
    if (tipoServicio) filtro.tipoServicio = tipoServicio;
    if (estado) filtro.estado = estado;

    const pedidos = await pedidosCol
      .find(filtro)
      .sort({ creado: -1 })
      .limit(200)
      .project({ tenantId: 0 })
      .toArray();

    res.json(pedidos.map(p => ({ ...p, creado: p.creado.toISOString() })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al listar pedidos' });
  }
});

app.patch('/api/:slug/pedidos/:id', extraerTenant, requiereAuth, async (req, res) => {
  try {
    const { estado, razonCancelacion } = req.body || {};
    const rol = req.user.rol;

    if (rol === 'mesero') {
      return res.status(403).json({ error: 'Los meseros no pueden cambiar estados' });
    }
    if (rol === 'cocina' && (estado === 'entregado' || estado === 'cancelado')) {
      return res.status(403).json({ error: 'Solo caja u owner pueden finalizar pedidos' });
    }
    if (estado === 'cancelado' && !['owner', 'caja'].includes(rol)) {
      return res.status(403).json({ error: 'Solo caja u owner pueden cancelar pedidos' });
    }
    if (estado === 'cancelado' && rol === 'caja') {
      if (!razonCancelacion || !String(razonCancelacion).trim()) {
        return res.status(400).json({ error: 'Debes indicar la razón de la cancelación' });
      }
    }

    const estadosValidos = (req.tenant.configuracion?.estados || []).map(e => e.id);
    if (!estadosValidos.includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const pedidoActual = await pedidosCol.findOne({
      tenantId: req.tenant._id,
      id: req.params.id,
    });
    if (!pedidoActual) return res.status(404).json({ error: 'Pedido no encontrado' });

    const update = { estado, actualizado: new Date() };

    if (estado === 'cancelado') {
      update.canceladoPor = req.user.nombre || req.user.email || 'Desconocido';
      update.canceladoPorRol = req.user.rol;
      update.canceladoEn = new Date();
      update.canceladoDesdeEstado = pedidoActual.estado;
      update.razonCancelacion = razonCancelacion
        ? String(razonCancelacion).trim().slice(0, 200)
        : null;
    }

    const resultado = await pedidosCol.findOneAndUpdate(
      { tenantId: req.tenant._id, id: req.params.id },
      { $set: update },
      { returnDocument: 'after', projection: { tenantId: 0 } }
    );

    if (!resultado) return res.status(404).json({ error: 'Pedido no encontrado' });

    if (
      resultado.tipoServicio === 'dineIn' &&
      resultado.mesa &&
      (resultado.estado === 'entregado' || resultado.estado === 'cancelado')
    ) {
      await mesasCol.updateOne(
        { tenantId: req.tenant._id, numero: resultado.mesa.numero },
        { $pull: { pedidosActivos: resultado.id }, $set: { actualizada: new Date() } }
      );
    }

    res.json({ ...resultado, creado: resultado.creado.toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar el pedido' });
  }
});

app.get('/api/:slug/pedidos/:id/estado', extraerTenant, async (req, res) => {
  try {
    const pedido = await pedidosCol.findOne(
      { tenantId: req.tenant._id, id: req.params.id },
      { projection: { _id: 0, id: 1, estado: 1, total: 1 } }
    );
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json(pedido);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al buscar el pedido' });
  }
});

// ============================================================
// TICKET IMPRIMIBLE
// ============================================================

app.get('/:slug/ticket/:id', extraerTenant, requiereAuth, async (req, res) => {
  try {
    const pedido = await pedidosCol.findOne({
      tenantId: req.tenant._id,
      id: req.params.id,
    });

    if (!pedido) return res.status(404).send('Pedido no encontrado');

    const hora = new Date(pedido.creado).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    const fecha = new Date(pedido.creado).toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const tipoLabel = {
      retiro: 'RETIRO EN LOCAL',
      delivery: 'DELIVERY',
      dineIn: `EN MESA · Mesa ${pedido.mesa?.numero || '?'}`,
    }[pedido.tipoServicio] || pedido.tipoServicio;

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <title>Ticket #${pedido.id}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: "Courier New", Courier, monospace; background: #eee; display: flex; justify-content: center; padding: 20px; }
          .ticket { background: #fff; width: 58mm; padding: 6mm 4mm; color: #000; font-size: 12px; line-height: 1.4; }
          .ticket .center { text-align: center; }
          .ticket .nombre { font-size: 16px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px; }
          .ticket .subtitulo { font-size: 9px; letter-spacing: 2px; margin-bottom: 8px; }
          .ticket hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
          .ticket .linea { display: flex; justify-content: space-between; gap: 8px; }
          .ticket .numero-pedido { font-size: 24px; font-weight: bold; text-align: center; letter-spacing: 2px; margin: 6px 0; }
          .ticket .tipo { text-align: center; font-size: 12px; font-weight: bold; padding: 5px 0; border-top: 1px solid #000; border-bottom: 1px solid #000; margin: 6px 0; letter-spacing: 1px; }
          .ticket .items { margin: 8px 0; }
          .ticket .item { margin-bottom: 6px; }
          .ticket .item-head { display: flex; justify-content: space-between; font-weight: bold; gap: 8px; }
          .ticket .item-cant { margin-right: 4px; }
          .ticket .item-detalle { font-size: 11px; padding-left: 16px; color: #333; }
          .ticket .item-nota { font-size: 11px; padding-left: 16px; font-style: italic; }
          .ticket .totales { margin-top: 8px; }
          .ticket .total-final { display: flex; justify-content: space-between; font-size: 16px; font-weight: bold; margin-top: 6px; padding-top: 6px; border-top: 2px solid #000; }
          .ticket .cliente { font-size: 12px; margin: 6px 0; }
          .ticket .pie { text-align: center; font-size: 10px; margin-top: 10px; letter-spacing: 1px; }
          .no-imprimir { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); display: flex; gap: 12px; }
          .no-imprimir button { padding: 14px 28px; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 13px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; cursor: pointer; border: 1px solid #0a0a0a; }
          .btn-print { background: #0a0a0a; color: #fff; border-color: #0a0a0a; }
          .btn-close { background: #fff; color: #0a0a0a; }
          @media print { body { background: #fff; padding: 0; display: block; } .ticket { width: 100%; padding: 0; box-shadow: none; } .no-imprimir { display: none; } }
        </style>
      </head>
      <body>
        <div class="ticket">
          <div class="center">
            <div class="nombre">${req.tenant.nombre}</div>
            <div class="subtitulo">TICKET DE COCINA</div>
          </div>
          <div class="linea" style="font-size: 11px;"><span>${fecha}</span><span>${hora}</span></div>
          <hr>
          <div class="numero-pedido">#${pedido.id}</div>
          <div class="tipo">${tipoLabel}</div>
          <div class="cliente">
            <div class="linea"><span>Cliente:</span><span>${pedido.cliente.nombre}</span></div>
            ${pedido.cliente.telefono ? `<div class="linea"><span>Tel:</span><span>${pedido.cliente.telefono}</span></div>` : ''}
            ${pedido.tipoServicio === 'delivery' && pedido.direccion ? `<div style="margin-top: 4px;"><div>Dir:</div><div style="padding-left: 8px;">${pedido.direccion}</div></div>` : ''}
          </div>
          <hr>
          <div class="items">
            ${pedido.items.map(i => `
              <div class="item">
                <div class="item-head">
                  <span><span class="item-cant">${i.cantidad}×</span>${i.nombre}</span>
                  <span>$${Number(i.subtotal).toFixed(2)}</span>
                </div>
                ${i.variante ? `<div class="item-detalle">· ${i.variante}</div>` : ''}
                ${i.extras && i.extras.length > 0 ? i.extras.map(e => `<div class="item-detalle">+ ${e.nombre}${e.cantidad > 1 ? ` x${e.cantidad}` : ''}</div>`).join('') : ''}
                ${i.opciones && i.opciones.length > 0 ? i.opciones.map(o => `<div class="item-detalle">· ${o.valor}</div>`).join('') : ''}
                ${i.notas ? `<div class="item-nota">"${i.notas}"</div>` : ''}
              </div>
            `).join('')}
          </div>
          <hr>
          <div class="totales">
            <div class="linea"><span>Subtotal</span><span>$${Number(pedido.subtotal).toFixed(2)}</span></div>
            <div class="linea"><span>IVA 16%</span><span>$${Number(pedido.iva).toFixed(2)}</span></div>
            ${pedido.costoEnvio > 0 ? `<div class="linea"><span>Envío</span><span>$${Number(pedido.costoEnvio).toFixed(2)}</span></div>` : ''}
            <div class="total-final"><span>TOTAL</span><span>$${Number(pedido.total).toFixed(2)}</span></div>
          </div>
          ${pedido.notas ? `<hr><div style="font-size: 11px;"><strong>NOTAS:</strong> ${pedido.notas}</div>` : ''}
          <div class="pie">¡Gracias por su pedido!</div>
        </div>
        <div class="no-imprimir">
          <button class="btn-print" onclick="window.print()">Imprimir</button>
          <button class="btn-close" onclick="window.close()">Cerrar</button>
        </div>
      </body>
      </html>
    `;

    res.type('text/html').send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al generar ticket');
  }
});

app.get('/:slug/ticket-mesa/:numero', extraerTenant, requiereAuth, async (req, res) => {
  try {
    const numero = parseInt(req.params.numero, 10);

    const pedidosMesa = await pedidosCol
      .find({
        tenantId: req.tenant._id,
        tipoServicio: 'dineIn',
        'mesa.numero': numero,
        estado: { $nin: ['entregado', 'cancelado'] },
      })
      .sort({ creado: 1 })
      .toArray();

    if (pedidosMesa.length === 0) return res.status(404).send('No hay pedidos activos en esta mesa');

    // Agrupar por pedido (cada pedido = un cliente)
    let subtotal = 0, iva = 0, total = 0;
    const pedidosAgrupados = pedidosMesa.map(p => {
      subtotal += p.subtotal || 0;
      iva += p.iva || 0;
      total += p.total || 0;
      return {
        id: p.id,
        cliente: p.cliente.nombre || '—',
        items: p.items,
      };
    });

    const hora = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
    const fecha = new Date().toLocaleDateString('es', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const html = `
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <title>Ticket · Mesa ${numero}</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body { font-family: "Courier New", Courier, monospace; background: #eee; display: flex; justify-content: center; padding: 20px; }
          .ticket { background: #fff; width: 58mm; padding: 6mm 4mm; color: #000; font-size: 12px; line-height: 1.4; }
          .center { text-align: center; }
          .nombre { font-size: 16px; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 2px; }
          .subtitulo { font-size: 9px; letter-spacing: 2px; margin-bottom: 8px; }
          hr { border: none; border-top: 1px dashed #000; margin: 6px 0; }
          .linea { display: flex; justify-content: space-between; gap: 8px; }
          .numero-pedido { font-size: 26px; font-weight: bold; text-align: center; letter-spacing: 2px; margin: 8px 0; }
          .tipo { text-align: center; font-size: 12px; font-weight: bold; padding: 5px 0; border-top: 1px solid #000; border-bottom: 1px solid #000; margin: 6px 0; letter-spacing: 1px; }
          .cliente-grupo { margin: 10px 0; }
          .cliente-nombre { font-weight: bold; font-size: 12px; text-transform: uppercase; letter-spacing: 1px; padding-bottom: 3px; border-bottom: 1px solid #000; margin-bottom: 4px; }
          .items { margin: 4px 0; }
          .item { margin-bottom: 5px; }
          .item-head { display: flex; justify-content: space-between; font-weight: bold; gap: 8px; }
          .item-cant { margin-right: 4px; }
          .item-detalle { font-size: 11px; padding-left: 16px; color: #333; }
          .item-nota { font-size: 11px; padding-left: 16px; font-style: italic; }
          .totales { margin-top: 8px; }
          .total-final { display: flex; justify-content: space-between; font-size: 16px; font-weight: bold; margin-top: 6px; padding-top: 6px; border-top: 2px solid #000; }
          .pie { text-align: center; font-size: 10px; margin-top: 10px; letter-spacing: 1px; }
          .no-imprimir { position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); display: flex; gap: 12px; }
          .no-imprimir button { padding: 14px 28px; font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 13px; font-weight: bold; letter-spacing: 1px; text-transform: uppercase; cursor: pointer; border: 1px solid #0a0a0a; }
          .btn-print { background: #0a0a0a; color: #fff; border-color: #0a0a0a; }
          .btn-close { background: #fff; color: #0a0a0a; }
          @media print { body { background: #fff; padding: 0; display: block; } .ticket { width: 100%; padding: 0; } .no-imprimir { display: none; } }
        </style>
      </head>
      <body>
        <div class="ticket">
          <div class="center">
            <div class="nombre">${req.tenant.nombre}</div>
            <div class="subtitulo">CUENTA · MESA</div>
          </div>
          <div class="linea" style="font-size: 11px;"><span>${fecha}</span><span>${hora}</span></div>
          <hr>
          <div class="numero-pedido">MESA ${numero}</div>
          <div class="tipo">EN MESA</div>
          <hr>
          ${pedidosAgrupados.map(g => `
            <div class="cliente-grupo">
              <div class="cliente-nombre">${g.cliente}</div>
              <div class="items">
                ${g.items.map(i => `
                  <div class="item">
                    <div class="item-head">
                      <span><span class="item-cant">${i.cantidad}×</span>${i.nombre}</span>
                      <span>$${Number(i.subtotal).toFixed(2)}</span>
                    </div>
                    ${i.variante ? `<div class="item-detalle">· ${i.variante}</div>` : ''}
                    ${i.extras && i.extras.length > 0 ? i.extras.map(e => `<div class="item-detalle">+ ${e.nombre}${e.cantidad > 1 ? ` x${e.cantidad}` : ''}</div>`).join('') : ''}
                    ${i.opciones && i.opciones.length > 0 ? i.opciones.map(o => `<div class="item-detalle">· ${o.valor}</div>`).join('') : ''}
                    ${i.notas ? `<div class="item-nota">"${i.notas}"</div>` : ''}
                  </div>
                `).join('')}
              </div>
            </div>
          `).join('')}
          <hr>
          <div class="totales">
            <div class="linea"><span>Subtotal</span><span>$${subtotal.toFixed(2)}</span></div>
            <div class="linea"><span>IVA 16%</span><span>$${iva.toFixed(2)}</span></div>
            <div class="total-final"><span>TOTAL</span><span>$${total.toFixed(2)}</span></div>
          </div>
          <div class="pie">¡Gracias por su preferencia!</div>
        </div>
        <div class="no-imprimir">
          <button class="btn-print" onclick="window.print()">Imprimir</button>
          <button class="btn-close" onclick="window.close()">Cerrar</button>
        </div>
      </body>
      </html>
    `;

    res.type('text/html').send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send('Error al generar ticket');
  }
});

// ============================================================
// RUTAS DE FRONTEND
// ============================================================

app.get('/rubedo', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'rubedo.html'));
});
app.get('/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/:slug/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/:slug/mesa/:numero', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/:slug/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/:slug/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Landing
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="utf-8">
      <title>Hermes · Demo</title>
      <style>
        body { font-family: "Helvetica Neue", Helvetica, Arial, sans-serif; background: #fafaf7; color: #0a0a0a;
               display: flex; flex-direction: column; align-items: center;
               justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
        h1 { font-size: 2.5rem; letter-spacing: -0.03em; margin: 0 0 8px; }
        p.sub { color: #666; margin-bottom: 40px; text-transform: uppercase; letter-spacing: 0.15em; font-size: 0.75rem; }
        a { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 20px;
            padding: 20px 24px; margin: 6px; border: 1px solid #0a0a0a; background: #fff;
            color: #0a0a0a; text-decoration: none; min-width: 340px;
            transition: 0.15s; }
        a:hover { background: #0a0a0a; color: #fff; }
        a span.tipo { font-family: monospace; font-size: 0.7rem; text-transform: uppercase; opacity: 0.6; }
        a strong { font-size: 1rem; letter-spacing: -0.01em; }
      </style>
    </head>
    <body>
      <h1>Hermes</h1>
      <p class="sub">Sistema de pedidos</p>
      <a href="/tenerife"><strong>Pizzería Tenerife</strong><span class="tipo">pizzeria</span></a>
      <a href="/pastor"><strong>Taquería El Pastor</strong><span class="tipo">taqueria</span></a>
      <a href="/central"><strong>Cafetería Central</strong><span class="tipo">cafeteria</span></a>
    </body>
    </html>
  `);
});

// Ping cada 4 minutos para mantener el cluster despierto
setInterval(async () => {
  try { await db.command({ ping: 1 }); }
  catch (e) { console.error('Ping falló:', e.message); }
}, 4 * 60 * 1000);

// ---------- Arranque ----------
conectarDB()
  .then(() => {
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🍽️  Hermes en http://localhost:${PORT}`);
      console.log(`   Tenerife:   http://localhost:${PORT}/tenerife`);
      console.log(`   Pastor:     http://localhost:${PORT}/pastor`);
      console.log(`   Central:    http://localhost:${PORT}/central`);
    });

    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
    server.timeout = 120000;

    server.on('clientError', (err, socket) => {
      if (err.code === 'ECONNRESET' || !socket.writable) {
        socket.destroy();
        return;
      }
      socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
    });
  })
  .catch(err => {
    console.error('❌ No se pudo conectar a MongoDB:', err.message);
    process.exit(1);
  });

process.on('SIGINT', async () => {
  await client.close();
  process.exit(0);
});