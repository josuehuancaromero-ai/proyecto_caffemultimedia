const cafe = require("../models/cafe");

const CONTEXTO_CAFETERIA = `
Eres el asistente virtual de Café Aroma, una cafetería en Bolivia. Responde en
español, de forma amable, natural y breve. Usa exclusivamente la información
actual de la cafetería proporcionada abajo. No inventes productos, ingredientes,
precios, promociones, servicios, horarios, ubicación, disponibilidad ni políticas.
Si el dato no aparece en la información, dilo claramente y ofrece el teléfono o
correo de contacto. Puedes responder preguntas variadas sobre menú, precios,
horarios, ubicación, contacto, servicios, especialidades e historia. Para temas
ajenos a la cafetería, explica amablemente que tu función se limita a Café Aroma.

INFORMACIÓN ACTUAL DE MYSQL:
`;

const OLLAMA_URL = (
  process.env.OLLAMA_URL || "http://127.0.0.1:11434"
).replace(/\/+$/, "");
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "gemma3";
const OLLAMA_TIMEOUT_MS = 60000;
const MAX_PROMPT_LENGTH = 4000;

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function formatPrice(value) {
  return `Bs ${Number(value).toFixed(2)}`;
}

function knownAnswer(question, cafeData) {
  const query = normalize(question);
  const { precios, servicios, especialidades, contacto } = cafeData;
  const days = [
    ["domingo", contacto.horarios.domingo],
    ["sabado", contacto.horarios.sabado],
    ["lunes", contacto.horarios.lunesAViernes],
    ["martes", contacto.horarios.lunesAViernes],
    ["miercoles", contacto.horarios.lunesAViernes],
    ["jueves", contacto.horarios.lunesAViernes],
    ["viernes", contacto.horarios.lunesAViernes],
  ];

  if (/\b(horario|horarios|abren|abierto|abren|cierran|cerrado)\b/.test(query)) {
    const day = days.find(([name]) => query.includes(name));
    if (day) return `El horario del ${day[0]} es ${day[1]}.`;
    return `Nuestros horarios son: lunes a viernes ${contacto.horarios.lunesAViernes}, sábado ${contacto.horarios.sabado} y domingo ${contacto.horarios.domingo}.`;
  }

  if (/\b(ubicacion|direccion|donde estan|donde queda|como llego)\b/.test(query)) {
    return `Estamos en ${contacto.direccion}.`;
  }
  if (/\b(telefono|numero|llamar|contactar|contacto|correo|email)\b/.test(query)) {
    return `Puedes comunicarte con nosotros al ${contacto.telefono} o escribir a ${contacto.correo}.`;
  }
  if (/\b(historia|sobre ustedes|sobre cafe aroma|quienes son|nosotros)\b/.test(query)) {
    return contacto.historia || `Somos Café Aroma. Puedes conocernos en ${contacto.direccion}.`;
  }

  const matchedPrice = precios.find((item) => {
    const name = normalize(item.servicio);
    return query.includes(name) || name.split(/\s+/).some((word) => word.length >= 5 && query.includes(word));
  });
  if (/\b(cuanto|precio|precios|cuesta|cuestan|vale|valen|costo|costos)\b/.test(query)) {
    if (matchedPrice) {
      return `${matchedPrice.servicio} cuesta ${formatPrice(matchedPrice.precio)}.`;
    }
    return `Estos son los precios registrados en nuestra carta: ${precios.map((item) => `${item.servicio}: ${formatPrice(item.precio)}`).join("; ")}.`;
  }

  if (/\b(menu|carta|que ofrecen|que venden|opciones|para comer|para beber|desayuno|brunch)\b/.test(query)) {
    if (/\b(sin cafe|sin cafeina|no cafe|sin lactosa|vegano|vegetariano|gluten)\b/.test(query)) {
      const food = precios.filter((item) =>
        /\b(alimentos|postres|experiencias)\b/.test(normalize(item.categoria)),
      );
      return `No tengo bebidas especiales confirmadas en la carta. Sí figuran estos alimentos y postres: ${food.map((item) => `${item.servicio}: ${formatPrice(item.precio)}`).join("; ")}.`;
    }
    return `En nuestra carta figuran: ${precios.map((item) => `${item.servicio}: ${formatPrice(item.precio)}`).join("; ")}.`;
  }

  if (/\b(especialidades|especialidad|baristas|barista|chef|equipo)\b/.test(query)) {
    return `Nuestro equipo incluye: ${especialidades.map((item) => `${item.nombre}, ${item.especialidad}`).join("; ")}.`;
  }

  const matchedService = servicios.find((item) => {
    const name = normalize(item.nombre);
    return query.includes(name) || name.split(/\s+/).some((word) => word.length >= 5 && query.includes(word));
  });
  if (matchedService && /\b(eventos|reserva|reservar|celebracion|cumpleanos)\b/.test(query)) {
    return `${matchedService.nombre}: ${matchedService.descripcion} Precio registrado: ${formatPrice(matchedService.precio)}.`;
  }

  return null;
}

async function getCafeData() {
  const [precios, servicios, especialidades, contacto] = await Promise.all([
    cafe.findAll("cafe_precios"),
    cafe.findAll("cafe_servicios"),
    cafe.findAll("cafe_especialidades"),
    cafe.findContacto(),
  ]);
  if (!contacto) throw httpError(503, "No se encontró la información de la cafetería");
  return { precios, servicios, especialidades, contacto };
}

async function prompt(req, res) {
  const { prompt: question } = req.body;
  if (
    typeof question !== "string" ||
    !question.trim() ||
    question.length > MAX_PROMPT_LENGTH
  ) {
    throw httpError(
      400,
      `prompt debe ser un texto no vacío de hasta ${MAX_PROMPT_LENGTH} caracteres`,
    );
  }

  const cafeData = await getCafeData();
  const directResponse = knownAnswer(question, cafeData);
  if (directResponse) {
    return res.json({ response: directResponse });
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, OLLAMA_TIMEOUT_MS);

  let data;
  try {
    const response = await fetch(`${OLLAMA_URL}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        system: `${CONTEXTO_CAFETERIA}${JSON.stringify(cafeData)}`,
        prompt: question.trim(),
        stream: false,
        options: { temperature: 0.2 },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw httpError(502, "El servicio de IA no pudo procesar la solicitud");
    }
    data = await response.json();
  } catch (error) {
    if (error.status) {
      throw error;
    }
    if (timedOut) {
      throw httpError(504, "El servicio de IA excedió el tiempo de espera");
    }
    throw httpError(502, "No se pudo conectar con el servicio de IA");
  } finally {
    clearTimeout(timeout);
  }

  if (!data || typeof data.response !== "string") {
    throw httpError(502, "El servicio de IA devolvió una respuesta no válida");
  }

  res.json({ response: data.response.trim() });
}

module.exports = { prompt, knownAnswer };
