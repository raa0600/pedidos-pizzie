// scripts/update-imagenes.js
// Ejecutar con: node scripts/update-imagenes.js
// Actualiza el campo "imagen" de todos los productos existentes.
// Usa URLs directas de Unsplash (estables, gratis, sin API key).

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME || 'pizzeria';

if (!MONGO_URI) {
  console.error('❌ Falta MONGO_URI en el .env');
  process.exit(1);
}

// ============================================================
// Helper: construye URL normalizada desde el ID del CDN
// ============================================================

const UNSPLASH = (id) =>
  `https://images.unsplash.com/photo-${id}?w=640&h=400&fit=crop&q=80&auto=format`;

const IMAGENES = {
  // ------------------------------------------------------------
  // Pizzería Tenerife
  // ------------------------------------------------------------
  'Margarita':                    UNSPLASH('1513104890138-7c749659a591'),
  'Pepperoni':                    UNSPLASH('1628840042765-356cda07504e'),
  'Cuatro Quesos':                UNSPLASH('1571407970349-bc81e7e96d47'),
  'Empanada de carne':            UNSPLASH('1619683551918-8479aaa01a94'),
  'Empanada de jamón y queso':    UNSPLASH('1619683551918-8479aaa01a94'),
  'Coca-Cola':                    UNSPLASH('1554866585-cd94860890b7'),
  'Agua mineral':                 UNSPLASH('1548839140-29a749e1cf4d'),
  'Tiramisú':                     UNSPLASH('1571877227200-a0d98ea607e9'),

  // ------------------------------------------------------------
  // Taquería El Pastor
  // ------------------------------------------------------------
  'Taco al pastor':               UNSPLASH('1565299585323-38d6b0865b47'),
  'Taco de bistec':               UNSPLASH('1551504734-5ee1c4a1479b'),
  'Taco de suadero':              UNSPLASH('1613514785940-daed07799d9b'),
  'Quesadilla':                   UNSPLASH('1618040996337-56904b7850b9'),
  'Orden de tacos (5 pz)':        UNSPLASH('1552332386-f8dd00dc2f85'),
  'Agua fresca':                  UNSPLASH('1544145945-f90425340c7e'),
  'Refresco':                     UNSPLASH('1581006852262-e4307cf6283a'),
  'Flan napolitano':              UNSPLASH('1702728109878-c61a98d80491'),

  // ------------------------------------------------------------
  // Cafetería Central
  // ------------------------------------------------------------
  'Espresso':                     UNSPLASH('1510707577719-ae7c14805e3a'),
  'Latte':                        UNSPLASH('1592284441621-581ebd2e677d'),
  'Capuchino':                    UNSPLASH('1777471524206-63cd2b9fb5b2'),
  'Frappé de café':               UNSPLASH('1461023058943-07fcbe16d735'),
  'Croissant':                    UNSPLASH('1555507036-ab1f4038808a'),
  'Panqué de plátano':            UNSPLASH('1606101273945-e9eba91c0dc4'),
  'Sándwich de jamón y queso':    UNSPLASH('1528735602780-2552fd46c7af'),
};

// ============================================================
// SCRIPT PRINCIPAL
// ============================================================

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log('✅ Conectado a MongoDB');
  const db = client.db(DB_NAME);
  const menusCol = db.collection('menus');

  const productos = await menusCol.find({}).toArray();
  console.log(`📦 ${productos.length} productos encontrados\n`);

  let actualizados = 0;
  let sinImagen = 0;

  for (const p of productos) {
    const url = IMAGENES[p.nombre];

    if (!url) {
      console.log(`   ⚠️  Sin imagen para "${p.nombre}"`);
      sinImagen++;
      continue;
    }

    if (p.imagen === url) {
      console.log(`   ⏭️  "${p.nombre}" ya está actualizado`);
      continue;
    }

    await menusCol.updateOne(
      { _id: p._id },
      { $set: { imagen: url } }
    );
    console.log(`   ✅ "${p.nombre}"`);
    actualizados++;
  }

  console.log(`\n🎉 Listo`);
  console.log(`   Actualizados: ${actualizados}`);
  console.log(`   Sin imagen:   ${sinImagen}`);
  console.log(`   Total:        ${productos.length}`);

  await client.close();
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});