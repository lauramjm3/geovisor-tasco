/* MAPA DEL GEOVISOR — Tasco / Páramo de Pisba
 * Regla de seguridad: todo texto que viene de los datos se escribe con textContent,
 * nunca con innerHTML, para que nadie pueda meter código en un reporte. */
(function () {
  'use strict';

  var CFG = window.CONFIG, CATS = window.CATEGORIAS, SIN = window.SINONIMOS, LG = window.Logica;
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, txt) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt !== undefined && txt !== null) e.textContent = txt;
    return e;
  }
  var catById = {};
  CATS.forEach(function (c) { catById[c.id] = c; });

  var state = { tab: 'mineria', cats: {}, term: '', muni: 'todos', user: null };
  CATS.forEach(function (c) { state.cats[c.id] = true; });

  /* ---------- MAPA ---------- */
  var map = L.map('map', { zoomControl: true }).setView(CFG.CENTRO, CFG.ZOOM);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18, attribution: '&copy; Colaboradores de OpenStreetMap'
  }).addTo(map);
  var cluster = L.markerClusterGroup({ maxClusterRadius: 40 });
  map.addLayer(cluster);
  var capas = { titulos: null, paramo: null, agua: null };
  var titulos = [];   // { p: propiedades, layer }
  var reportes = [];  // { p, lat, lon, marker }
  var userMarker = null;

  /* ---------- DATOS ---------- */
  function cargar(url) {
    return fetch(url, { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error(url); return r.json(); })
      .catch(function () { return null; });
  }

  Promise.all([
    cargar('data/titulos.geojson'), cargar('data/paramo_pisba.geojson'),
    cargar('data/cursos_agua.geojson'), cargar('data/reportes_publicos.geojson')
  ]).then(function (d) {
    iniciarCapas(d[0], d[1], d[2]);
    iniciarReportes(d[3]);
    if ((d[0] && d[0].datos_ejemplo) || (d[3] && d[3].datos_ejemplo)) $('aviso-ejemplo').hidden = false;
    if (!d[0] && !d[3]) $('estado-datos').textContent = 'No se pudieron cargar los datos. Revise su conexión e intente de nuevo.';
    render();
  });

  function colorTitulo(p) {
    var e = LG.norm(p.estado_licencia || p.estado_titulo);
    if (e.indexOf('vigente') === 0) return '#0F5C57';
    if (e.indexOf('suspendid') === 0) return '#B4532A';
    if (e.indexOf('tramite') !== -1) return '#A9791F';
    return '#5B6B6A';
  }
  function estiloTitulo(p, hover) {
    var c = colorTitulo(p);
    return { color: c, weight: hover ? 3 : 1.6, fillColor: c, fillOpacity: hover ? 0.38 : 0.2 };
  }

  function iniciarCapas(dt, dp, da) {
    if (dt && dt.features) {
      capas.titulos = L.geoJSON(dt, {
        style: function (f) { return estiloTitulo(f.properties || {}, false); },
        onEachFeature: function (f, layer) {
          var p = f.properties || {};
          titulos.push({ p: p, layer: layer });
          layer.bindTooltip((p.nombre_proyecto || 'Título') + ' · ' + (p.id_titulo_anm || ''), { sticky: true });
          layer.on('mouseover', function () { layer.setStyle(estiloTitulo(p, true)); });
          layer.on('mouseout', function () { layer.setStyle(estiloTitulo(p, false)); });
          layer.on('click', function () { abrirTitulo(p, layer); });
        }
      }).addTo(map);
    }
    if (dp && dp.features) {
      capas.paramo = L.geoJSON(dp, {
        interactive: false,
        style: { color: '#2F6B3E', weight: 2, dashArray: '6 6', fillColor: '#2F6B3E', fillOpacity: 0.06 }
      }).addTo(map);
      capas.paramo.bringToBack();
    }
    if (da && da.features) {
      capas.agua = L.geoJSON(da, { interactive: false, style: { color: '#1B7FA8', weight: 2.5, opacity: 0.85 } }).addTo(map);
    }
    ['titulos', 'paramo', 'agua'].forEach(function (k) {
      var cb = $('capa-' + k);
      if (!capas[k]) { cb.disabled = true; cb.parentNode.title = 'Esta capa aún no está disponible'; return; }
      cb.addEventListener('change', function () {
        if (cb.checked) map.addLayer(capas[k]); else map.removeLayer(capas[k]);
        if (capas.paramo && map.hasLayer(capas.paramo)) capas.paramo.bringToBack();
      });
    });
  }

  function iconoPin(cat) {
    var wrap = el('div', 'pin');
    wrap.style.background = cat.color;
    if (LG.iconoEsArchivo(cat.icono)) {
      var img = el('img'); img.src = cat.icono; img.alt = ''; wrap.appendChild(img);
    } else {
      wrap.appendChild(el('span', null, cat.icono));
    }
    return L.divIcon({ className: '', html: wrap, iconSize: [34, 34], iconAnchor: [17, 17] });
  }
  function catPrincipal(p) {
    var t = (p.tipos && p.tipos.length ? p.tipos : ['otro']).filter(function (x) { return catById[x]; });
    return catById[t[0]] || catById.otro;
  }

  function iniciarReportes(dr) {
    var munis = {};
    if (dr && dr.features) {
      dr.features.forEach(function (f) {
        if (!f.geometry || f.geometry.type !== 'Point') return;
        var c = f.geometry.coordinates, p = f.properties || {};
        if (typeof c[0] !== 'number' || typeof c[1] !== 'number') return;
        var r = { p: p, lat: c[1], lon: c[0], marker: null };
        r.marker = L.marker([r.lat, r.lon], { icon: iconoPin(catPrincipal(p)), title: p.tipos_texto || 'Reporte' });
        r.marker.on('click', function () { abrirReporte(r); });
        reportes.push(r);
        if (p.municipio) munis[p.municipio] = true;
      });
    }
    var sel = $('filtro-municipio');
    Object.keys(munis).sort().forEach(function (m) {
      var o = el('option', null, m); o.value = m; sel.appendChild(o);
    });
  }

  /* ---------- FILTROS / PESTAÑAS ---------- */
  function botonesCategorias() {
    CATS.forEach(function (c) {
      var b = el('button', 'cat on'); b.type = 'button'; b.setAttribute('aria-pressed', 'true');
      var ic = el('span', 'cat-ic');
      if (LG.iconoEsArchivo(c.icono)) { var im = el('img'); im.src = c.icono; im.alt = ''; ic.appendChild(im); }
      else ic.textContent = c.icono;
      b.appendChild(ic); b.appendChild(el('span', 'cat-tx', c.nombre));
      b.addEventListener('click', function () {
        state.cats[c.id] = !state.cats[c.id];
        b.classList.toggle('on', state.cats[c.id]);
        b.setAttribute('aria-pressed', String(state.cats[c.id]));
        render();
      });
      $('cats-' + c.pestana).appendChild(b);
    });
  }

  function setTab(name) {
    state.tab = name;
    ['mineria', 'agua', 'reportes'].forEach(function (t) {
      var on = t === name;
      $('tab-' + t).setAttribute('aria-selected', String(on));
      $('pane-' + t).hidden = !on;
    });
  }
  ['mineria', 'agua', 'reportes'].forEach(function (t) {
    $('tab-' + t).addEventListener('click', function () { cerrarDetalle(); setTab(t); });
  });

  $('busqueda').addEventListener('input', function () { state.term = this.value; render(); });
  $('filtro-municipio').addEventListener('change', function () { state.muni = this.value; render(); });
  $('btn-limpiar').addEventListener('click', function () { $('busqueda').value = ''; state.term = ''; render(); });

  /* ---------- DIBUJO DE RESULTADOS ---------- */
  function visibles() {
    return reportes.filter(function (r) {
      var tipos = r.p.tipos && r.p.tipos.length ? r.p.tipos : ['otro'];
      var algunaActiva = tipos.some(function (t) { return state.cats[catById[t] ? t : 'otro']; });
      if (!algunaActiva) return false;
      if (state.muni !== 'todos' && r.p.municipio !== state.muni) return false;
      return LG.coincideReporte(r.p, state.term, SIN);
    });
  }

  function distanciaA(lat, lon) {
    return state.user ? LG.distanciaM(state.user[0], state.user[1], lat, lon) : null;
  }

  function render() {
    var vis = visibles();
    cluster.clearLayers();
    vis.forEach(function (r) { cluster.addLayer(r.marker); });

    /* lista de reportes */
    var lista = $('lista-reportes');
    lista.textContent = '';
    var orden = vis.map(function (r) { return { r: r, d: distanciaA(r.lat, r.lon) }; });
    orden.sort(function (a, b) {
      if (state.user) return a.d - b.d;
      return String(b.r.p.fecha || '').localeCompare(String(a.r.p.fecha || ''));
    });
    orden.forEach(function (o) { lista.appendChild(tarjetaReporte(o.r, o.d)); });
    $('conteo-reportes').textContent = vis.length === 1 ? '1 reporte' : vis.length + ' reportes';
    $('vacio-reportes').hidden = vis.length > 0;
    $('estado-datos').textContent = '';

    /* títulos que coinciden con la búsqueda */
    var lt = $('lista-titulos');
    lt.textContent = '';
    var hayTerm = LG.norm(state.term) !== '';
    var tit = titulos.filter(function (t) { return LG.coincideTitulo(t.p, state.term); });
    $('bloque-titulos').hidden = !hayTerm;
    if (hayTerm) {
      tit.forEach(function (t) { lt.appendChild(tarjetaTitulo(t)); });
      $('vacio-titulos').hidden = tit.length > 0;
    }
    $('btn-limpiar').hidden = !hayTerm;
  }

  function tarjetaReporte(r, d) {
    var c = catPrincipal(r.p);
    var b = el('button', 'tarjeta'); b.type = 'button';
    var ic = el('span', 'tarjeta-ic'); ic.style.background = c.color;
    if (LG.iconoEsArchivo(c.icono)) { var im = el('img'); im.src = c.icono; im.alt = ''; ic.appendChild(im); } else ic.textContent = c.icono;
    var cuerpo = el('span', 'tarjeta-cuerpo');
    cuerpo.appendChild(el('strong', null, r.p.tipos_texto || c.nombre));
    var meta = [r.p.municipio, r.p.vereda, r.p.fecha].filter(Boolean).join(' · ');
    cuerpo.appendChild(el('span', 'meta', meta));
    if (d != null) cuerpo.appendChild(el('span', 'dist', 'A ' + LG.formatoDist(d) + (r.p.ubicacion === 'generalizada' ? ' (aprox.)' : '')));
    b.appendChild(ic); b.appendChild(cuerpo);
    b.addEventListener('click', function () { abrirReporte(r); });
    return b;
  }

  function tarjetaTitulo(t) {
    var b = el('button', 'tarjeta'); b.type = 'button';
    var ic = el('span', 'tarjeta-ic'); ic.style.background = colorTitulo(t.p); ic.textContent = '▦';
    var cuerpo = el('span', 'tarjeta-cuerpo');
    cuerpo.appendChild(el('strong', null, (t.p.nombre_proyecto || 'Título minero') + ' · ' + (t.p.id_titulo_anm || '')));
    cuerpo.appendChild(el('span', 'meta', [t.p.municipio, t.p.mineral, t.p.estado_licencia && ('Licencia: ' + t.p.estado_licencia)].filter(Boolean).join(' · ')));
    b.appendChild(ic); b.appendChild(cuerpo);
    b.addEventListener('click', function () { abrirTitulo(t.p, t.layer); });
    return b;
  }

  /* ---------- FICHAS ---------- */
  var SIN_DATO = 'Sin dato';
  function fila(cont, etiqueta, valor) {
    var v = valor === undefined || valor === null || valor === '' ? SIN_DATO : String(valor);
    var f = el('div', 'fila');
    f.appendChild(el('span', 'fila-e', etiqueta));
    f.appendChild(el('span', v === SIN_DATO ? 'fila-v vacio' : 'fila-v', v));
    cont.appendChild(f);
  }
  function mostrarDetalle(kicker, titulo) {
    $('tabs').hidden = true;
    ['mineria', 'agua', 'reportes'].forEach(function (t) { $('pane-' + t).hidden = true; });
    $('detalle').hidden = false;
    var c = $('detalle-contenido'); c.textContent = '';
    c.appendChild(el('div', 'kicker', kicker));
    c.appendChild(el('h2', 'detalle-titulo', titulo));
    $('panel').scrollTop = 0;
    return c;
  }
  function cerrarDetalle() {
    $('detalle').hidden = true; $('tabs').hidden = false; setTab(state.tab);
  }
  $('detalle-volver').addEventListener('click', cerrarDetalle);

  function abrirTitulo(p, layer) {
    map.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 15 });
    var c = mostrarDetalle('Título minero', p.nombre_proyecto || p.id_titulo_anm || 'Título');
    var g = el('div', 'filas');
    fila(g, 'Número de título', p.id_titulo_anm);
    fila(g, 'Titular', p.titular);
    fila(g, 'Municipio / vereda', [p.municipio, p.vereda].filter(Boolean).join(' · '));
    fila(g, 'Mineral', p.mineral);
    fila(g, 'Método de explotación', p.metodo_explotacion);
    fila(g, 'Área (ha)', p.area_ha);
    fila(g, 'Fecha de otorgamiento', p.fecha_otorgamiento);
    fila(g, 'Estado del título', p.estado_titulo);
    fila(g, 'Licencia ambiental', [p.estado_licencia, p.fecha_licencia].filter(Boolean).join(' · '));
    fila(g, 'Expediente ambiental', p.expediente_ambiental);
    fila(g, 'Autoridad ambiental', p.autoridad_ambiental);
    fila(g, 'Estudio de impacto (EIA)', p.tiene_eia);
    fila(g, 'Plan de manejo (PMA)', p.tiene_pma);
    fila(g, 'Plan de trabajo (PTO)', p.tiene_pto);
    fila(g, 'Superpuesto con el páramo', p.superpuesto_paramo_pisba == null || p.superpuesto_paramo_pisba === '' ? null :
      p.superpuesto_paramo_pisba + (p.pct_area_superpuesta != null && p.pct_area_superpuesta !== '' ? ' (' + p.pct_area_superpuesta + ' % del área)' : ''));
    fila(g, 'Concesión de agua asociada', p.concesion_agua_asociada);
    fila(g, 'Procesos sancionatorios activos', p.sancionatorios_activos);
    fila(g, 'Fecha del último acto', p.fecha_ultimo_acto);
    c.appendChild(g);
    c.appendChild(el('div', 'seccion', 'De dónde sale este dato'));
    var f = el('div', 'filas');
    fila(f, 'Fuente', p.fuente_dato);
    fila(f, 'Verificado el', p.fecha_verificacion);
    c.appendChild(f);
    if (LG.urlSegura(p.link_fuente)) {
      var a = el('a', 'enlace', 'Ver documento fuente'); a.href = p.link_fuente.trim();
      a.target = '_blank'; a.rel = 'noopener noreferrer'; c.appendChild(a);
    }
  }

  function abrirReporte(r) {
    var p = r.p, cat = catPrincipal(p);
    map.setView([r.lat, r.lon], Math.max(map.getZoom(), 14));
    var c = mostrarDetalle('Reporte comunitario', p.tipos_texto || cat.nombre);
    if (p.ubicacion === 'generalizada') {
      c.appendChild(el('p', 'nota', 'La persona que reportó pidió no mostrar el punto exacto. El mapa muestra el centro de la vereda.'));
    }
    if (p.fotos && p.fotos.length) {
      p.fotos.filter(LG.rutaFotoSegura).forEach(function (src) {
        var im = el('img', 'foto'); im.src = src; im.alt = 'Foto del reporte'; im.loading = 'lazy'; c.appendChild(im);
      });
    }
    var g = el('div', 'filas');
    fila(g, 'Fecha del hecho', p.fecha);
    fila(g, 'Municipio', p.municipio);
    fila(g, 'Vereda', p.vereda);
    if (p.tipo_otro) fila(g, 'Otro tipo (descrito)', p.tipo_otro);
    fila(g, 'Título minero asociado', p.titulo_asociado);
    c.appendChild(g);
    if (p.descripcion) {
      c.appendChild(el('div', 'seccion', 'Lo que se observó'));
      c.appendChild(el('p', 'texto', p.descripcion));
    }
    c.appendChild(el('div', 'seccion', 'Notificación a entidades'));
    var n = el('div', 'filas');
    fila(n, '¿Se notificó?', p.notificado);
    if (p.notificado === 'Sí') {
      fila(n, 'Entidades', p.entidades && p.entidades.join(', '));
      fila(n, 'Fecha', p.fecha_notificacion);
      fila(n, 'Respuesta', p.respuesta);
    }
    c.appendChild(n);
    if (p.ph != null || p.turbidez_ntu != null || p.conductividad_us != null) {
      c.appendChild(el('div', 'seccion', 'Medidas del agua'));
      var w = el('div', 'filas');
      fila(w, 'pH', p.ph); fila(w, 'Turbidez (NTU)', p.turbidez_ntu); fila(w, 'Conductividad (µS/cm)', p.conductividad_us);
      c.appendChild(w);
    }
  }

  /* ---------- CERCA DE MÍ ---------- */
  $('btn-cerca').addEventListener('click', function () {
    var msg = $('msg-cerca');
    if (!navigator.geolocation) { msg.textContent = 'Este navegador no permite usar la ubicación.'; return; }
    msg.textContent = 'Buscando su ubicación…';
    navigator.geolocation.getCurrentPosition(function (pos) {
      state.user = [pos.coords.latitude, pos.coords.longitude];
      if (userMarker) map.removeLayer(userMarker);
      userMarker = L.circleMarker(state.user, { radius: 8, color: '#fff', weight: 2, fillColor: '#1565C0', fillOpacity: 1 }).addTo(map);
      map.setView(state.user, 13);
      cerrarDetalle(); setTab('reportes'); render();
      msg.textContent = 'Reportes ordenados del más cercano al más lejano. Su ubicación no sale de su teléfono.';
    }, function () {
      msg.textContent = 'No se pudo obtener su ubicación. Revise que el permiso esté activado.';
    }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 });
  });

  /* ---------- BOTÓN KOBO ---------- */
  (function () {
    var a = $('btn-kobo');
    if (LG.urlSegura(CFG.KOBO_FORM_URL)) {
      a.href = CFG.KOBO_FORM_URL; a.target = '_blank'; a.rel = 'noopener noreferrer';
    } else {
      a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); a.classList.add('apagado');
      a.title = 'El formulario aún no está conectado';
    }
  })();

  window.addEventListener('resize', function () { map.invalidateSize(); });
  botonesCategorias();
  setTab('mineria');
})();
