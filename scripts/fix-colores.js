// scripts/fix-colores.js
// Ejecutar con: node scripts/fix-colores.js
//
// Limpia los colores de los tenants existentes:
//   - Si tienen "colorPrimario", mueve su valor a "colorAcento"
//   - Elimina el campo "colorPrimario" (ya no se usa)
//   - Si un tenant no tiene colorAcento, le pone el naranja por defecto
//
// NO borra nada. Solo actualiza "configuracion.colorAcento" y
// elimina "configuracion.colorPrimario".

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME || 'pizzeria';

if (!MONGO_URI) {
  console.error('❌ Falta MONGO_URI en el .env');
  process.exit(1);
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log('✅ Conectado a MongoDB');
  const db = client.db(DB_NAME);
  const tenantsCol = db.collection('tenants');

  const tenants = await tenantsCol.find({}).toArray();
  console.log(`📦 ${tenants.length} tenants encontrados\n`);

  let actualizados = 0;

  for (const t of tenants) {
    const c = t.configuracion || {};
    const tienePrimario = !!c.colorPrimario;
    const tieneAcento = !!c.colorAcento;

    // Decidir el color final:
    //   1) Si tiene colorPrimario → ese gana (era el "color de marca" en el esquema viejo)
    //   2) Si no, y tiene colorAcento → se queda como está
    //   3) Si no tiene ninguno → naranja por defecto
    let colorFinal = c.colorPrimario || c.colorAcento || '#ff4d00';

    const necesitaUpdate = tienePrimario || !tieneAcento;

    if (!necesitaUpdate) {
      console.log(`⏭️  /${t.slug} · "${t.nombre}" — ya está limpio (colorAcento: ${c.colorAcento})`);
      continue;
    }

    await tenantsCol.updateOne(
      { _id: t._id },
      {
        $set: { 'configuracion.colorAcento': colorFinal },
        $unset: { 'configuracion.colorPrimario': '' },
      }
    );

    console.log(`✅ /${t.slug} · "${t.nombre}"`);
    if (tienePrimario) console.log(`      colorPrimario (${c.colorPrimario}) → colorAcento`);
    else console.log(`      seteado colorAcento por defecto`);
    actualizados++;
  }

  console.log(`\n🎉 Listo`);
  console.log(`   Tenants actualizados: ${actualizados}`);
  console.log(`   Tenants totales:      ${tenants.length}`);

  await client.close();
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});