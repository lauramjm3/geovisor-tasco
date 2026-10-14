/* CATEGORÍAS Y SINÓNIMOS
 *
 * - "id" debe ser IGUAL al valor del formulario de Kobo (hoja "choices" del XLSForm).
 * - "pestana" decide en cuál pestaña aparece el botón: "mineria" o "agua".
 * - "icono" es PROVISIONAL (emoji). Cuando el cliente entregue los íconos del taller,
 *   se cambian aquí (ver GUIA al final de este archivo).
 * - Los SINÓNIMOS de abajo son una propuesta inicial: reemplácelos con la lista real
 *   que use la comunidad. Escriba las palabras en minúscula y SIN tildes.
 */
window.CATEGORIAS = [
  { id: "apertura_socavon",       nombre: "Socavón o bocamina nueva",   pestana: "mineria", icono: "⛏️", color: "#B4532A" },
  { id: "grietas_vivienda",       nombre: "Grietas en vivienda o terreno", pestana: "mineria", icono: "🏚️", color: "#8A5A2B" },
  { id: "maquinaria_activa",      nombre: "Maquinaria en operación",    pestana: "mineria", icono: "🚜", color: "#A9791F" },
  { id: "ruido_explosiones",      nombre: "Explosiones o vibraciones",  pestana: "mineria", icono: "💥", color: "#9C3D3D" },
  { id: "tala_paramo",            nombre: "Tala en el páramo",          pestana: "mineria", icono: "🌲", color: "#2F6B3E" },
  { id: "otro",                   nombre: "Otro",                       pestana: "mineria", icono: "📍", color: "#5B6B6A" },
  { id: "secamiento_nacimiento",  nombre: "Nacimiento seco",            pestana: "agua",    icono: "💧", color: "#1B7FA8" },
  { id: "contaminacion_agua",     nombre: "Agua contaminada",           pestana: "agua",    icono: "🧪", color: "#6A4C93" },
  { id: "sedimentacion_quebrada", nombre: "Quebrada con sedimento",     pestana: "agua",    icono: "🌊", color: "#7A6A4F" }
];

window.SINONIMOS = {
  "hueco": ["apertura_socavon"], "mina vieja": ["apertura_socavon"], "bocamina": ["apertura_socavon"],
  "socavon": ["apertura_socavon"], "tunel": ["apertura_socavon"], "boquete": ["apertura_socavon"],
  "grieta": ["grietas_vivienda"], "rajadura": ["grietas_vivienda"], "hundimiento": ["grietas_vivienda"],
  "casa rajada": ["grietas_vivienda"], "se esta hundiendo": ["grietas_vivienda"],
  "volqueta": ["maquinaria_activa"], "retroexcavadora": ["maquinaria_activa"], "maquina": ["maquinaria_activa"],
  "camion": ["maquinaria_activa"], "maquinaria": ["maquinaria_activa"],
  "explosion": ["ruido_explosiones"], "dinamita": ["ruido_explosiones"], "retumba": ["ruido_explosiones"],
  "vibracion": ["ruido_explosiones"], "ruido": ["ruido_explosiones"], "temblor": ["ruido_explosiones"],
  "tala": ["tala_paramo"], "tumbaron": ["tala_paramo"], "frailejon": ["tala_paramo"], "arboles": ["tala_paramo"],
  "se seco": ["secamiento_nacimiento"], "sin agua": ["secamiento_nacimiento"], "nacimiento": ["secamiento_nacimiento"],
  "ojo de agua": ["secamiento_nacimiento"], "manantial": ["secamiento_nacimiento"], "seco": ["secamiento_nacimiento"],
  "agua sucia": ["contaminacion_agua"], "agua turbia": ["contaminacion_agua"], "agua contaminada": ["contaminacion_agua"],
  "contaminacion": ["contaminacion_agua"], "aceite": ["contaminacion_agua"], "olor": ["contaminacion_agua"],
  "lodo": ["sedimentacion_quebrada"], "barro": ["sedimentacion_quebrada"], "sedimento": ["sedimentacion_quebrada"],
  "quebrada tapada": ["sedimentacion_quebrada"]
};

/* GUÍA: cómo poner los íconos del taller cuando el cliente los entregue
 *  1. Guarde cada ícono como iconos/<id>.svg (ejemplo: iconos/apertura_socavon.svg).
 *  2. En esta lista, en cada categoría, cambie  icono: "⛏️"  por  icono: "iconos/apertura_socavon.svg".
 *  3. El mapa detecta solo si el ícono es un archivo (termina en .svg o .png) o un emoji.
 */
