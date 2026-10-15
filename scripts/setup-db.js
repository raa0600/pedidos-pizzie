// scripts/setup-db.js
// Ejecutar UNA VEZ con: node scripts/setup-db.js
// Crea tenants, usuarios, menús, mesas e índices. Borra TODO lo anterior.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { MongoClient } = require('mongodb');
const bcrypt = require('bcryptjs');

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME || 'pizzeria';

if (!MONGO_URI) {
  console.error('❌ Falta MONGO_URI en el .env');
  process.exit(1);
}

// ============================================================
// PRESETS DE TENANTS
// ============================================================

const TENANTS = [
  // ------------------------------------------------------------
  // PIZZERÍA TENERIFE
  // ------------------------------------------------------------
  {
    slug: 'tenerife',
    nombre: 'Pizzería Tenerife',
    tipo: 'pizzeria',
    email: 'contacto@tenerife.com',
    telefono: '4771112233',
    plan: 'pro',
    configuracion: {
      servicios: { retiro: true, delivery: true, dineIn: true },
      estados: [
        { id: 'pendiente',  label: 'Pendiente',   siguiente: 'en_horno' },
        { id: 'en_horno',   label: 'En el horno', siguiente: 'listo' },
        { id: 'listo',      label: 'Listo',       siguiente: 'entregado' },
        { id: 'entregado',  label: 'Entregado',   siguiente: null },
        { id: 'cancelado',  label: 'Cancelado',   siguiente: null },
      ],
      tiempoEspera: 45,
      colorAcento: '#ff4d00',
      logoUrl: null,
      aceptaMitades: true,
      delivery: {
        pedidoMinimo: 150,
        zonas: [
          { id: 'centro', nombre: 'Centro', costo: 25 },
          { id: 'norte',  nombre: 'Zona Norte', costo: 35 },
          { id: 'sur',    nombre: 'Zona Sur', costo: 40 },
        ],
      },
    },
    usuarios: [
      { email: 'owner@tenerife.com',   password: 'owner123',   nombre: 'Marco Tenerife', rol: 'owner' },
      { email: 'cocina@tenerife.com',  password: 'cocina123',  nombre: 'Chef Andrea',    rol: 'cocina' },
      { email: 'caja@tenerife.com',    password: 'caja123',    nombre: 'Lucía Caja',     rol: 'caja' },
      { email: 'mesero@tenerife.com',  password: 'mesero123',  nombre: 'Diego Mesero',   rol: 'mesero' },
    ],
    mesas: 10,
    menu: [
      {
        categoria: 'Pizzas',
        nombre: 'Margarita',
        descripcion: 'Tomate, mozzarella y albahaca fresca',
        imagen: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?w=400',
        variantes: [
          { id: 'chica',    nombre: 'Chica',    precio: 140 },
          { id: 'mediana',  nombre: 'Mediana',  precio: 180 },
          { id: 'grande',   nombre: 'Grande',   precio: 220 },
        ],
        extras: [],
        opciones: [],
        orden: 1,
      },
      {
        categoria: 'Pizzas',
        nombre: 'Pepperoni',
        descripcion: 'Mozzarella y pepperoni picante',
        imagen: 'https://images.unsplash.com/photo-1628840042765-356cda07504e?w=400',
        variantes: [
          { id: 'chica',    nombre: 'Chica',    precio: 150 },
          { id: 'mediana',  nombre: 'Mediana',  precio: 190 },
          { id: 'grande',   nombre: 'Grande',   precio: 230 },
        ],
        extras: [
          { id: 'queso',   nombre: 'Queso extra',   precio: 25, max: 1 },
          { id: 'tocino',  nombre: 'Tocino',        precio: 30, max: 1 },
          { id: 'jalapeno', nombre: 'Jalapeños',    precio: 15, max: 1 },
        ],
        opciones: [],
        orden: 2,
      },
      {
        categoria: 'Pizzas',
        nombre: 'Cuatro Quesos',
        descripcion: 'Mozzarella, provolone, azul y parmesano',
        imagen: 'https://images.unsplash.com/photo-1571407970349-bc81e7e96d47?w=400',
        variantes: [
          { id: 'chica',    nombre: 'Chica',    precio: 160 },
          { id: 'mediana',  nombre: 'Mediana',  precio: 200 },
          { id: 'grande',   nombre: 'Grande',   precio: 240 },
        ],
        extras: [],
        opciones: [],
        orden: 3,
      },
      {
        categoria: 'Empanadas',
        nombre: 'Empanada de carne',
        descripcion: 'Cortada a cuchillo',
        imagen: null,
        precio: 30,
        variantes: [],
        extras: [],
        opciones: [],
        orden: 1,
      },
      {
        categoria: 'Empanadas',
        nombre: 'Empanada de jamón y queso',
        descripcion: '',
        imagen: null,
        precio: 30,
        variantes: [],
        extras: [],
        opciones: [],
        orden: 2,
      },
      {
        categoria: 'Bebidas',
        nombre: 'Coca-Cola',
        descripcion: '',
        imagen: null,
        variantes: [
          { id: 'chica',   nombre: 'Chica 355ml',  precio: 25 },
          { id: 'mediana', nombre: 'Mediana 600ml', precio: 35 },
          { id: 'grande',  nombre: 'Grande 1.5L',  precio: 55 },
        ],
        extras: [],
        opciones: [],
        orden: 1,
      },
      {
        categoria: 'Bebidas',
        nombre: 'Agua mineral',
        descripcion: '',
        imagen: null,
        precio: 20,
        variantes: [],
        extras: [],
        opciones: [],
        orden: 2,
      },
      {
        categoria: 'Postres',
        nombre: 'Tiramisú',
        descripcion: 'Porción casera',
        imagen: null,
        precio: 60,
        variantes: [],
        extras: [],
        opciones: [],
        orden: 1,
      },
    ],
  },

  // ------------------------------------------------------------
  // TAQUERÍA EL PASTOR
  // ------------------------------------------------------------
  {
    slug: 'pastor',
    nombre: 'Taquería El Pastor',
    tipo: 'taqueria',
    email: 'contacto@elpastor.com',
    telefono: '4772223344',
    plan: 'basico',
    configuracion: {
      servicios: { retiro: true, delivery: true, dineIn: true },
      estados: [
        { id: 'pendiente',  label: 'Pendiente',   siguiente: 'preparando' },
        { id: 'preparando', label: 'Preparando',  siguiente: 'listo' },
        { id: 'listo',      label: 'Listo',       siguiente: 'entregado' },
        { id: 'entregado',  label: 'Entregado',   siguiente: null },
        { id: 'cancelado',  label: 'Cancelado',   siguiente: null },
      ],
      tiempoEspera: 20,
      colorAcento: '#d62828',
      logoUrl: null,
      aceptaMitades: false,
      delivery: {
        pedidoMinimo: 100,
        zonas: [
          { id: 'centro', nombre: 'Centro', costo: 20 },
          { id: 'norte',  nombre: 'Zona Norte', costo: 30 },
        ],
      },
    },
    usuarios: [
      { email: 'owner@pastor.com',   password: 'owner123',   nombre: 'Ricardo Pastor', rol: 'owner' },
      { email: 'cocina@pastor.com',  password: 'cocina123',  nombre: 'Chef Raúl',      rol: 'cocina' },
      { email: 'caja@pastor.com',    password: 'caja123',    nombre: 'Sofía Caja',     rol: 'caja' },
      { email: 'mesero@pastor.com',  password: 'mesero123',  nombre: 'Karla Mesera',   rol: 'mesero' },
    ],
    mesas: 12,
    menu: [
      {
        categoria: 'Tacos',
        nombre: 'Taco al pastor',
        descripcion: 'Carne al pastor con piña, cebolla y cilantro',
        imagen: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=400',
        variantes: [],
        precio: 18,
        extras: [
          { id: 'queso',   nombre: 'Queso',           precio: 5, max: 1 },
          { id: 'salsa',   nombre: 'Salsa extra',     precio: 0, max: 1 },
          { id: 'pina',    nombre: 'Piña extra',      precio: 3, max: 1 },
        ],
        opciones: [
          {
            id: 'tortilla',
            nombre: 'Tipo de tortilla',
            tipo: 'radio',
            requerido: true,
            valores: [
              { id: 'maiz',   nombre: 'Maíz',   precio: 0 },
              { id: 'harina', nombre: 'Harina', precio: 2 },
            ],
          },
        ],
        orden: 1,
      },
      {
        categoria: 'Tacos',
        nombre: 'Taco de bistec',
        descripcion: 'Bistec a la plancha con cebolla y cilantro',
        imagen: null,
        variantes: [],
        precio: 22,
        extras: [
          { id: 'queso',   nombre: 'Queso', precio: 5, max: 1 },
          { id: 'salsa',   nombre: 'Salsa extra', precio: 0, max: 1 },
        ],
        opciones: [
          {
            id: 'tortilla',
            nombre: 'Tipo de tortilla',
            tipo: 'radio',
            requerido: true,
            valores: [
              { id: 'maiz',   nombre: 'Maíz',   precio: 0 },
              { id: 'harina', nombre: 'Harina', precio: 2 },
            ],
          },
        ],
        orden: 2,
      },
      {
        categoria: 'Tacos',
        nombre: 'Taco de suadero',
        descripcion: 'Suadero con cebolla y cilantro',
        imagen: null,
        variantes: [],
        precio: 20,
        extras: [],
        opciones: [],
        orden: 3,
      },
      {
        categoria: 'Especialidades',
        nombre: 'Quesadilla',
        descripcion: 'Tortilla con queso derretido y guisado a elegir',
        imagen: null,
        variantes: [],
        precio: 45,
        extras: [
          { id: 'crema',  nombre: 'Crema',  precio: 5, max: 1 },
          { id: 'guac',   nombre: 'Guacamole', precio: 15, max: 1 },
        ],
        opciones: [
          {
            id: 'guisado',
            nombre: 'Guisado',
            tipo: 'radio',
            requerido: true,
            valores: [
              { id: 'pastor',   nombre: 'Pastor',   precio: 0 },
              { id: 'bistec',   nombre: 'Bistec',   precio: 5 },
              { id: 'suadero',  nombre: 'Suadero',  precio: 3 },
              { id: 'queso',    nombre: 'Solo queso', precio: 0 },
            ],
          },
        ],
        orden: 1,
      },
      {
        categoria: 'Especialidades',
        nombre: 'Orden de tacos (5 pz)',
        descripcion: 'Cinco tacos surtidos',
        imagen: null,
        variantes: [],
        precio: 90,
        extras: [],
        opciones: [],
        orden: 2,
      },
      {
        categoria: 'Bebidas',
        nombre: 'Agua fresca',
        descripcion: 'Horchata, jamaica o limón',
        imagen: null,
        variantes: [
          { id: 'chica',  nombre: 'Vaso chico',  precio: 20 },
          { id: 'grande', nombre: 'Vaso grande', precio: 30 },
          { id: 'jarra',  nombre: 'Jarra 1L',    precio: 60 },
        ],
        extras: [],
        opciones: [
          {
            id: 'sabor',
            nombre: 'Sabor',
            tipo: 'radio',
            requerido: true,
            valores: [
              { id: 'horchata', nombre: 'Horchata', precio: 0 },
              { id: 'jamaica',  nombre: 'Jamaica',  precio: 0 },
              { id: 'limon',    nombre: 'Limón',    precio: 0 },
            ],
          },
        ],
        orden: 1,
      },
      {
        categoria: 'Bebidas',
        nombre: 'Refresco',
        descripcion: '',
        imagen: null,
        variantes: [
          { id: 'chica',  nombre: '355ml',  precio: 25 },
          { id: 'grande', nombre: '600ml',  precio: 35 },
        ],
        extras: [],
        opciones: [],
        orden: 2,
      },
      {
        categoria: 'Postres',
        nombre: 'Flan napolitano',
        descripcion: '',
        imagen: null,
        precio: 40,
        variantes: [],
        extras: [],
        opciones: [],
        orden: 1,
      },
    ],
  },

  // ------------------------------------------------------------
  // CAFETERÍA CENTRAL
  // ------------------------------------------------------------
  {
    slug: 'central',
    nombre: 'Cafetería Central',
    tipo: 'cafeteria',
    email: 'contacto@central.com',
    telefono: '4773334455',
    plan: 'free',
    configuracion: {
      servicios: { retiro: true, delivery: false, dineIn: true },
      estados: [
        { id: 'pendiente',  label: 'Pendiente',  siguiente: 'preparando' },
        { id: 'preparando', label: 'Preparando', siguiente: 'listo' },
        { id: 'listo',      label: 'Listo',      siguiente: 'entregado' },
        { id: 'entregado',  label: 'Entregado',  siguiente: null },
        { id: 'cancelado',  label: 'Cancelado',  siguiente: null },
      ],
      tiempoEspera: 15,
      colorAcento: '#78350f',
      logoUrl: null,
      aceptaMitades: false,
      delivery: {
        pedidoMinimo: 0,
        zonas: [],
      },
    },
    usuarios: [
      { email: 'owner@central.com',   password: 'owner123',   nombre: 'Elena Central', rol: 'owner' },
      { email: 'cocina@central.com',  password: 'cocina123',  nombre: 'Barista Pablo', rol: 'cocina' },
      { email: 'caja@central.com',    password: 'caja123',    nombre: 'Marcela Caja',  rol: 'caja' },
      { email: 'mesero@central.com',  password: 'mesero123',  nombre: 'Iván Mesero',   rol: 'mesero' },
    ],
    mesas: 8,
    menu: [
      {
        categoria: 'Café caliente',
        nombre: 'Espresso',
        descripcion: 'Café expreso doble',
        imagen: 'https://images.unsplash.com/photo-1510707577719-ae7c14805e3a?w=400',
        variantes: [
          { id: 'sencillo', nombre: 'Sencillo', precio: 35 },
          { id: 'doble',    nombre: 'Doble',    precio: 45 },
        ],
        extras: [
          { id: 'shot', nombre: 'Shot extra', precio: 15, max: 2 },
        ],
        opciones: [],
        orden: 1,
      },
      {
        categoria: 'Café caliente',
        nombre: 'Latte',
        descripcion: 'Espresso con leche vaporizada',
        imagen: null,
        variantes: [
          { id: 'chico',   nombre: 'Chico',   precio: 50 },
          { id: 'mediano', nombre: 'Mediano', precio: 60 },
          { id: 'grande',  nombre: 'Grande',  precio: 70 },
        ],
        extras: [
          { id: 'shot',     nombre: 'Shot extra',  precio: 15, max: 2 },
          { id: 'jarabe',   nombre: 'Jarabe',      precio: 10, max: 1 },
        ],
        opciones: [
          {
            id: 'leche',
            nombre: 'Tipo de leche',
            tipo: 'radio',
            requerido: true,
            valores: [
              { id: 'entera',      nombre: 'Entera',      precio: 0 },
              { id: 'deslactosada', nombre: 'Deslactosada', precio: 0 },
              { id: 'almendra',    nombre: 'Almendra',    precio: 15 },
              { id: 'avena',       nombre: 'Avena',       precio: 15 },
            ],
          },
        ],
        orden: 2,
      },
      {
        categoria: 'Café caliente',
        nombre: 'Capuchino',
        descripcion: 'Espresso con espuma de leche',
        imagen: null,
        variantes: [
          { id: 'chico',   nombre: 'Chico',   precio: 50 },
          { id: 'mediano', nombre: 'Mediano', precio: 60 },
        ],
        extras: [],
        opciones: [
          {
            id: 'leche',
            nombre: 'Tipo de leche',
            tipo: 'radio',
            requerido: true,
            valores: [
              { id: 'entera',      nombre: 'Entera',      precio: 0 },
              { id: 'deslactosada', nombre: 'Deslactosada', precio: 0 },
              { id: 'almendra',    nombre: 'Almendra',    precio: 15 },
            ],
          },
        ],
        orden: 3,
      },
      {
        categoria: 'Café frío',
        nombre: 'Frappé de café',
        descripcion: 'Café frío licuado con hielo',
        imagen: null,
        variantes: [
          { id: 'mediano', nombre: 'Mediano', precio: 65 },
          { id: 'grande',  nombre: 'Grande',  precio: 80 },
        ],
        extras: [
          { id: 'crema',   nombre: 'Crema batida', precio: 10, max: 1 },
          { id: 'chispas', nombre: 'Chispas de chocolate', precio: 10, max: 1 },
        ],
        opciones: [],
        orden: 1,
      },
      {
        categoria: 'Panadería',
        nombre: 'Croissant',
        descripcion: 'Mantequilla o chocolate',
        imagen: null,
        variantes: [
          { id: 'mantequilla', nombre: 'Mantequilla', precio: 40 },
          { id: 'chocolate',   nombre: 'Chocolate',   precio: 45 },
        ],
        extras: [],
        opciones: [],
        orden: 1,
      },
      {
        categoria: 'Panadería',
        nombre: 'Panqué de plátano',
        descripcion: '',
        imagen: null,
        precio: 45,
        variantes: [],
        extras: [],
        opciones: [],
        orden: 2,
      },
      {
        categoria: 'Sándwiches',
        nombre: 'Sándwich de jamón y queso',
        descripcion: 'Pan integral con jamón, queso y vegetales',
        imagen: null,
        precio: 70,
        variantes: [],
        extras: [
          { id: 'aguacate', nombre: 'Aguacate', precio: 15, max: 1 },
          { id: 'pavo',     nombre: 'Pavo extra', precio: 20, max: 1 },
        ],
        opciones: [
          {
            id: 'pan',
            nombre: 'Tipo de pan',
            tipo: 'radio',
            requerido: true,
            valores: [
              { id: 'integral', nombre: 'Integral', precio: 0 },
              { id: 'blanco',   nombre: 'Blanco',   precio: 0 },
              { id: 'ciabatta', nombre: 'Ciabatta', precio: 10 },
            ],
          },
        ],
        orden: 1,
      },
    ],
  },
];

// ============================================================
// SCRIPT PRINCIPAL
// ============================================================

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log('✅ Conectado a MongoDB');
  const db = client.db(DB_NAME);

  // Borrar todo
  console.log('🗑️  Borrando colecciones anteriores...');
  await db.collection('tenants').deleteMany({});
  await db.collection('usuarios').deleteMany({});
  await db.collection('menus').deleteMany({});
  await db.collection('pedidos').deleteMany({});
  await db.collection('mesas').deleteMany({});

  // Crear índices
  console.log('📇 Creando índices...');
  await db.collection('tenants').createIndex({ slug: 1 }, { unique: true });
  await db.collection('usuarios').createIndex({ tenantId: 1, email: 1 }, { unique: true });
  await db.collection('menus').createIndex({ tenantId: 1, categoria: 1, orden: 1 });
  await db.collection('menus').createIndex({ tenantId: 1, disponible: 1 });
  await db.collection('pedidos').createIndex({ tenantId: 1, creado: -1 });
  await db.collection('pedidos').createIndex({ tenantId: 1, estado: 1, creado: -1 });
  await db.collection('pedidos').createIndex({ tenantId: 1, id: 1 }, { unique: true });
  await db.collection('pedidos').createIndex({ tenantId: 1, tipoServicio: 1, creado: -1 });
  await db.collection('mesas').createIndex({ tenantId: 1, numero: 1 }, { unique: true });
  await db.collection('mesas').createIndex({ tenantId: 1, estado: 1 });
  console.log('   ✅ 10 índices creados');

  // Crear tenants
  for (const t of TENANTS) {
    console.log(`\n🏪 Creando tenant "${t.slug}" (${t.tipo})...`);

    const tenantDoc = {
      slug: t.slug,
      nombre: t.nombre,
      tipo: t.tipo,
      email: t.email,
      telefono: t.telefono,
      plan: t.plan,
      activo: true,
      creado: new Date(),
      configuracion: t.configuracion,
      limites: {
        maxPedidosMes: t.plan === 'free' ? 100 : null,
        maxUsuarios: t.plan === 'free' ? 3 : null,
        maxMesas: t.plan === 'free' ? 5 : null,
      },
    };
    const resultTenant = await db.collection('tenants').insertOne(tenantDoc);
    const tenantId = resultTenant.insertedId;
    console.log(`   ✅ Tenant creado (id: ${tenantId})`);

    // Usuarios
    for (const u of t.usuarios) {
      const hash = await bcrypt.hash(u.password, 10);
      await db.collection('usuarios').insertOne({
        tenantId,
        email: u.email.toLowerCase(),
        passwordHash: hash,
        nombre: u.nombre,
        rol: u.rol,
        activo: true,
        ultimoLogin: null,
        creado: new Date(),
      });
      console.log(`      👤 ${u.email} (${u.rol})`);
    }

    // Menú
    const menusDocs = t.menu.map((m, i) => ({
      tenantId,
      categoria: m.categoria,
      nombre: m.nombre,
      descripcion: m.descripcion || '',
      imagen: m.imagen || null,
      precio: m.precio ?? null,
      variantes: m.variantes || [],
      extras: m.extras || [],
      opciones: m.opciones || [],
      tags: m.tags || [],
      disponible: true,
      orden: m.orden || i + 1,
      creado: new Date(),
    }));
    await db.collection('menus').insertMany(menusDocs);
    console.log(`      🍽️  ${menusDocs.length} items de menú`);

    // Mesas
    if (t.mesas > 0) {
      const mesasDocs = [];
      for (let i = 1; i <= t.mesas; i++) {
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
      await db.collection('mesas').insertMany(mesasDocs);
      console.log(`      🪑 ${t.mesas} mesas creadas`);
    }
  }

  console.log('\n🎉 Base de datos lista\n');
  console.log('Tenants creados:');
  console.log('   /tenerife   → Pizzería Tenerife');
  console.log('   /pastor     → Taquería El Pastor');
  console.log('   /central    → Cafetería Central');
  console.log('');
  console.log('Credenciales (todas las contraseñas: owner123, cocina123, caja123, mesero123):');
  console.log('   owner@tenerife.com | cocina@tenerife.com | caja@tenerife.com | mesero@tenerife.com');
  console.log('   owner@pastor.com   | cocina@pastor.com   | caja@pastor.com   | mesero@pastor.com');
  console.log('   owner@central.com  | cocina@central.com  | caja@central.com  | mesero@central.com');
  console.log('');

  await client.close();
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});