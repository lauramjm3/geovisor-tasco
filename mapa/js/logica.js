/* LÓGICA PURA (sin mapa ni pantalla): búsqueda, sinónimos, distancias, seguridad de enlaces.
 * Está separada para poder probarla sola. */
(function (root) {
  'use strict';

  /* minúsculas, sin tildes, sin espacios dobles */
  function norm(s) {
    return String(s == null ? '' : s).toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim();
  }

  /* ¿Qué categorías oficiales sugiere lo que escribió la persona? */
  function categoriasDeBusqueda(term, sinonimos) {
    var t = norm(term), out = {};
    if (!t) return out;
    Object.keys(sinonimos).forEach(function (k) {
      var kn = norm(k);
      if (t.indexOf(kn) !== -1 || (t.length >= 3 && kn.indexOf(t) === 0)) {
        sinonimos[k].forEach(function (c) { out[c] = true; });
      }
    });
    return out;
  }

  function textoReporte(p) {
    return norm([p.tipos_texto, p.tipo_otro, p.descripcion, p.vereda, p.municipio, p.titulo_asociado].join(' '));
  }

  function coincideReporte(p, term, sinonimos) {
    var t = norm(term);
    if (!t) return true;
    var cats = categoriasDeBusqueda(term, sinonimos);
    var tipos = p.tipos && p.tipos.length ? p.tipos : ['otro'];
    for (var i = 0; i < tipos.length; i++) if (cats[tipos[i]]) return true;
    return textoReporte(p).indexOf(t) !== -1;
  }

  function coincideTitulo(p, term) {
    var t = norm(term);
    if (!t) return true;
    return norm([p.id_titulo_anm, p.nombre_proyecto, p.expediente_ambiental, p.municipio, p.vereda, p.mineral].join(' ')).indexOf(t) !== -1;
  }

  /* distancia en metros entre dos puntos (fórmula de Haversine) */
  function distanciaM(lat1, lon1, lat2, lon2) {
    var R = 6371000, rad = Math.PI / 180;
    var dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function formatoDist(m) {
    if (m == null || !isFinite(m)) return '';
    return m < 1000 ? Math.round(m / 10) * 10 + ' m' : (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km';
  }

  /* solo enlaces http/https (evita "javascript:" y similares) */
  function urlSegura(u) {
    return typeof u === 'string' && /^https?:\/\/[^\s"'<>]+$/i.test(u.trim());
  }

  /* solo fotos que el robot guardó en data/fotos/ */
  function rutaFotoSegura(r) {
    return typeof r === 'string' && /^data\/fotos\/[A-Za-z0-9_-]+\.jpg$/.test(r);
  }

  /* ¿el icono es un archivo (svg/png) o un emoji? */
  function iconoEsArchivo(i) { return typeof i === 'string' && /^[\w./-]+\.(svg|png)$/i.test(i); }

  var api = { norm: norm, categoriasDeBusqueda: categoriasDeBusqueda, coincideReporte: coincideReporte,
              coincideTitulo: coincideTitulo, distanciaM: distanciaM, formatoDist: formatoDist,
              urlSegura: urlSegura, rutaFotoSegura: rutaFotoSegura, iconoEsArchivo: iconoEsArchivo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Logica = api;
})(typeof window !== 'undefined' ? window : globalThis);
