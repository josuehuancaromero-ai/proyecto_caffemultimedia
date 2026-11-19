const database = require("../config/database");

const tables = {
  cafe_servicios: ["id", "nombre", "descripcion", "icono", "precio"],
  cafe_especialidades: ["id", "nombre", "especialidad", "foto", "descripcion"],
  cafe_precios: ["id", "servicio", "precio", "categoria"],
  cafe_testimonios: ["id", "cliente", "detalle", "comentario", "calificacion", "fecha"],
};

const adminTables = {
  servicios: tables.cafe_servicios,
  especialidades: tables.cafe_especialidades,
  precios: tables.cafe_precios,
  testimonios: tables.cafe_testimonios,
};

async function findAll(table) {
  if (!tables[table]) throw new Error("Tabla no permitida");
  const [rows] = await database.query(
    `SELECT ${tables[table].join(", ")} FROM ${table} ORDER BY id`,
  );
  return rows;
}

async function findAdminRows(entity) {
  if (entity === "mensajes") {
    const [rows] = await database.query(
      `SELECT id, nombre, correo, asunto, mensaje, fecha_creacion
       FROM cafe_mensajes ORDER BY fecha_creacion DESC`,
    );
    return rows;
  }
  const table = `cafe_${entity}`;
  if (!adminTables[entity]) throw new Error("Sección no permitida");
  return findAll(table);
}

async function createAdminRow(entity, fields) {
  const columns = adminTables[entity];
  if (!columns) throw new Error("Sección no permitida");
  const writable = columns.filter((column) => column !== "id");
  const values = writable.map((column) => fields[column] ?? null);
  const [result] = await database.execute(
    `INSERT INTO cafe_${entity} (${writable.join(", ")})
     VALUES (${writable.map(() => "?").join(", ")})`,
    values,
  );
  return findAdminRow(entity, result.insertId);
}

async function findAdminRow(entity, id) {
  const columns = adminTables[entity];
  if (!columns) throw new Error("Sección no permitida");
  const [rows] = await database.execute(
    `SELECT ${columns.join(", ")} FROM cafe_${entity} WHERE id = ?`,
    [id],
  );
  return rows[0] || null;
}

async function updateAdminRow(entity, id, fields) {
  const columns = adminTables[entity];
  if (!columns) throw new Error("Sección no permitida");
  const writable = columns.filter((column) => column !== "id" && column in fields);
  const [result] = await database.execute(
    `UPDATE cafe_${entity} SET ${writable.map((column) => `${column} = ?`).join(", ")} WHERE id = ?`,
    [...writable.map((column) => fields[column] ?? null), id],
  );
  if (!result.affectedRows) return null;
  return findAdminRow(entity, id);
}

async function deleteAdminRow(entity, id) {
  if (!adminTables[entity]) throw new Error("Sección no permitida");
  const [result] = await database.execute(
    `DELETE FROM cafe_${entity} WHERE id = ?`,
    [id],
  );
  return result.affectedRows > 0;
}

async function findContacto() {
  const [rows] = await database.query(
    `SELECT direccion, telefono, correo, lunes_viernes AS lunesAViernes,
      sabado, domingo, latitud, longitud, historia
     FROM cafe_contacto ORDER BY id LIMIT 1`,
  );
  if (!rows[0]) return null;
  return {
    direccion: rows[0].direccion,
    telefono: rows[0].telefono,
    correo: rows[0].correo,
    horarios: {
      lunesAViernes: rows[0].lunesAViernes,
      sabado: rows[0].sabado,
      domingo: rows[0].domingo,
    },
    coordenadas: {
      latitud: Number(rows[0].latitud),
      longitud: Number(rows[0].longitud),
    },
    historia: rows[0].historia,
  };
}

async function updateContacto(fields) {
  const [rows] = await database.query(
    "SELECT id FROM cafe_contacto ORDER BY id LIMIT 1",
  );
  if (!rows[0]) return null;

  await database.execute(
    `UPDATE cafe_contacto SET direccion = ?, telefono = ?, correo = ?,
      lunes_viernes = ?, sabado = ?, domingo = ?, latitud = ?, longitud = ?,
      historia = ? WHERE id = ?`,
    [
      fields.direccion,
      fields.telefono,
      fields.correo,
      fields.lunesAViernes,
      fields.sabado,
      fields.domingo,
      fields.latitud,
      fields.longitud,
      fields.historia ?? null,
      rows[0].id,
    ],
  );
  return findContacto();
}

async function createMessage({ nombre, correo, asunto, mensaje }) {
  const [result] = await database.execute(
    "INSERT INTO cafe_mensajes (nombre, correo, asunto, mensaje) VALUES (?, ?, ?, ?)",
    [nombre, correo, asunto, mensaje],
  );
  return { id: result.insertId, nombre, correo, asunto, mensaje };
}

module.exports = {
  findAll,
  findAdminRows,
  createAdminRow,
  updateAdminRow,
  deleteAdminRow,
  findContacto,
  updateContacto,
  createMessage,
};
