#!/usr/bin/env python3
"""
anonimizar.py - Filtro de seguridad del geovisor Tasco / Pisba.

QUE HACE
    Toma los reportes de KoboToolbox y genera data/reportes_publicos.geojson
    con SOLO lo que (1) la persona autorizo publicar y (2) el equipo aprobo
    en Kobo (Datos -> Tabla -> Estado de validacion = Aprobado).

REGLAS DE SEGURIDAD (no las cambie sin hablar con el equipo)
    1. Lista blanca: solo se copian los campos que este script nombra.
       Si manana Kobo agrega un campo nuevo, NO se publica por accidente.
    2. Falla cerrada: si algo esta vacio, raro o no se puede comprobar,
       el reporte NO se publica.
    3. Nunca se publican: nombre, telefono, anonimo, punto de referencia,
       presunto responsable, usuario de Kobo, ni identificadores de Kobo.
    4. "generalizada": se publica el centro de la vereda, nunca el punto.
    5. "solo_interno" o sin aprobar: no sale.
    6. Fotos: apagadas por defecto. Si se activan, solo salen las de reportes
       "exacta", se les borran los metadatos (GPS) y se les cambia el nombre.

USO NORMAL (lo ejecuta GitHub Actions; lee las claves de variables de entorno)
    python scripts/anonimizar.py

USO DE PRUEBA EN SU COMPUTADOR (sin internet, con el archivo de muestra)
    python scripts/anonimizar.py --entrada ..\\privado\\muestra_kobo.json ^
        --veredas ..\\privado\\veredas_prueba.geojson ^
        --salida ..\\privado\\salida_prueba.geojson
"""
import argparse
import hashlib
import io
import json
import math
import os
import re
import sys
from collections import Counter
from pathlib import Path

from shapely.geometry import Point, shape

# ======================================================================
# CONFIGURACION
# ======================================================================

# Solo estos niveles de autorizacion se publican (valores del XLSForm).
CONSENTIMIENTOS_PUBLICABLES = {"exacta", "generalizada"}

# Estado de validacion que Kobo asigna cuando el equipo marca "Aprobado".
ESTADO_APROBADO = "validation_status_approved"

# Cuantos decimales se conservan cuando la persona autorizo ubicacion exacta.
# 4 decimales ~ 11 metros. Cambie a 5 (~1 m) o 6 si el equipo lo decide.
DECIMALES_EXACTA = 4

# Nombre de la columna de la capa de veredas que trae el nombre de la vereda.
# El script usa la primera que exista. Ajuste segun el archivo real (IGAC: NOMBRE_VER).
CAMPOS_NOMBRE_VEREDA = ["NOMBRE_VER", "nombre_ver", "NOMBRE", "nombre", "VEREDA", "vereda"]

# Largo maximo de los textos libres que se publican.
MAX_TEXTO = 1500
MAX_TEXTO_CORTO = 150
MAX_FOTOS_POR_REPORTE = 6

# Valores del formulario -> texto que se muestra en el mapa.
MUNICIPIOS = {
    "tasco": "Tasco", "socota": "Socotá", "socha": "Socha", "gameza": "Gámeza",
    "jerico": "Jericó", "mongua": "Mongua", "chita": "Chita", "otro": "Otro",
}
TIPOS = {
    "apertura_socavon": "Apertura de socavón / bocamina nueva",
    "secamiento_nacimiento": "Secamiento de nacimiento o fuente de agua",
    "contaminacion_agua": "Contaminación visible del agua",
    "sedimentacion_quebrada": "Sedimentación / colmatación de quebrada",
    "grietas_vivienda": "Grietas en vivienda o terreno",
    "maquinaria_activa": "Maquinaria en operación fuera de horario o zona",
    "tala_paramo": "Tala o remoción de vegetación de páramo",
    "ruido_explosiones": "Ruido de explosiones o vibraciones",
    "otro": "Otro",
}
ENTIDADES = {
    "anm": "Agencia Nacional de Minería (ANM)", "corpoboyaca": "Corpoboyacá",
    "alcaldia": "Alcaldía municipal", "inspeccion_policia": "Inspección de Policía",
    "personeria": "Personería municipal",
    "procuraduria": "Procuraduría General de la Nación", "otro": "Otra",
}
RESPUESTAS = {
    "sin_respuesta": "No hubo ninguna respuesta",
    "respuesta_verbal": "Respuesta verbal, sin visita",
    "respuesta_escrita": "Respuesta escrita, sin visita",
    "visita_realizada": "Se realizó visita técnica",
}

# Campos privados: NUNCA se publican. Se usan solo para detectar fugas
# (si su contenido aparece copiado en un campo publico, el reporte se descarta).
# Cada tupla es (grupo, campo) tal como los escribe Kobo: "grupo/campo".
CAMPOS_PRIVADOS = [
    ("grp_reportante", "reportante_nombre"),
    ("grp_reportante", "reportante_contacto"),
    ("grp_ubicacion", "referencia_lugar"),
    ("grp_evento", "presunto_responsable"),
]

# Telefonos celulares colombianos escritos en textos libres (ej. 300 123 4567).
RE_TELEFONO = re.compile(r"(?<!\d)(?:\+?57[\s-]?)?3\d{2}[\s-]?\d{3}[\s-]?\d{4}(?!\d)")
# Coordenadas con 4 o mas decimales escritas en textos libres (ej. 5.9083).
RE_COORDENADA = re.compile(r"\d{1,3}[.,]\d{4,}")


# ======================================================================
# UTILIDADES
# ======================================================================

def valor(r, grupo, campo):
    """Lee un campo del reporte. Kobo escribe 'grupo/campo'; si no, prueba 'campo'.
    Kobo omite las respuestas vacias, por eso se devuelve None si no existe."""
    v = r.get(f"{grupo}/{campo}")
    if v is None:
        v = r.get(campo)
    if isinstance(v, str):
        v = v.strip()
    return v if v not in ("", None) else None


def texto(v, maximo=MAX_TEXTO):
    if not isinstance(v, str):
        return None
    v = "".join(c for c in v if c == "\n" or c >= " ").strip()
    return v[:maximo] if v else None


def numero(v):
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    return n if math.isfinite(n) else None


def lista(v):
    """select_multiple llega como 'a b c'."""
    return v.split() if isinstance(v, str) else []


def id_publico(r):
    base = str(r.get("_uuid") or r.get("meta/instanceID") or r.get("_id") or "")
    return "R-" + hashlib.sha256(base.encode("utf-8")).hexdigest()[:10]


def obtener_latlon(r):
    g = r.get("_geolocation")
    lat = lon = None
    if isinstance(g, (list, tuple)) and len(g) >= 2:
        lat, lon = numero(g[0]), numero(g[1])
    if lat is None or lon is None:
        partes = (valor(r, "grp_ubicacion", "punto_gps") or "").split()
        if len(partes) >= 2:
            lat, lon = numero(partes[0]), numero(partes[1])
    if lat is None or lon is None:
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return lat, lon


# ======================================================================
# VEREDAS
# ======================================================================

def cargar_veredas(ruta):
    """Devuelve [(geometria, nombre)]. Lista vacia si el archivo no existe."""
    p = Path(ruta)
    if not p.exists():
        print(f"AVISO: no existe {p}. Los reportes 'generalizada' NO se publicaran.")
        return []
    with open(p, encoding="utf-8") as f:
        datos = json.load(f)
    salida = []
    for feat in datos.get("features", []):
        if not feat.get("geometry"):
            continue
        geom = shape(feat["geometry"])
        if not geom.is_valid:
            geom = geom.buffer(0)
        props = feat.get("properties") or {}
        nombre = next((props[c] for c in CAMPOS_NOMBRE_VEREDA if props.get(c)), None)
        salida.append((geom, nombre))
    return salida


def centro_de_vereda(lat, lon, veredas):
    """Devuelve (lat, lon, nombre) del centro de la vereda que contiene el punto,
    o None si el punto no cae en ninguna vereda."""
    pt = Point(lon, lat)
    for geom, nombre in veredas:
        if geom.contains(pt):
            c = geom.centroid
            if not geom.contains(c):          # vereda concava: el centroide cae afuera
                c = geom.representative_point()
            return c.y, c.x, nombre
    return None


# ======================================================================
# FOTOS (apagadas por defecto)
# ======================================================================

def limpiar_foto(contenido):
    """Recibe los bytes de una foto y devuelve un JPEG SIN metadatos (sin GPS),
    reducido a 1280 px. Aplica primero la rotacion para que no quede de lado."""
    from PIL import Image, ImageOps
    img = Image.open(io.BytesIO(contenido))
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        fondo = Image.new("RGB", img.size, "white")
        fondo.paste(img, mask=img.split()[-1])
        img = fondo
    else:
        img = img.convert("RGB")
    img.thumbnail((1280, 1280))
    limpia = Image.new("RGB", img.size)      # lienzo nuevo: solo se copian los pixeles
    limpia.paste(img)
    salida = io.BytesIO()
    limpia.save(salida, format="JPEG", quality=80)   # sin pasar exif=
    return salida.getvalue()


def guardar_fotos(r, id_pub, token, carpeta):
    """Descarga las fotos del reporte con la clave de Kobo, las limpia y las guarda.
    Devuelve la lista de rutas relativas publicas (ej. 'data/fotos/R-ab12_1.jpg')."""
    import requests
    rutas = []
    carpeta.mkdir(parents=True, exist_ok=True)
    n = 0
    for a in r.get("_attachments", []):
        if a.get("is_deleted") or not str(a.get("mimetype", "")).startswith("image/"):
            continue
        url = a.get("download_large_url") or a.get("download_url")
        if not url:
            continue
        n += 1
        if n > MAX_FOTOS_POR_REPORTE:
            break
        resp = requests.get(url, headers={"Authorization": f"Token {token}"}, timeout=60)
        resp.raise_for_status()
        nombre = f"{id_pub}_{n}.jpg"
        (carpeta / nombre).write_bytes(limpiar_foto(resp.content))
        rutas.append(f"data/fotos/{nombre}")
    return rutas


def borrar_fotos_huerfanas(carpeta, conservar):
    """Si un reporte deja de publicarse, su foto tambien se borra del repositorio."""
    if not carpeta.exists():
        return
    for f in carpeta.glob("R-*.jpg"):
        if f.name not in conservar:
            f.unlink()


# ======================================================================
# KOBO
# ======================================================================

def leer_kobo(servidor, uid, token):
    import requests
    url = f"{servidor.rstrip('/')}/api/v2/assets/{uid}/data/?format=json&limit=500"
    cab = {"Authorization": f"Token {token}"}
    resultados, esperado = [], None
    while url:
        resp = requests.get(url, headers=cab, timeout=60)
        resp.raise_for_status()
        pag = resp.json()
        esperado = pag.get("count", esperado)
        resultados.extend(pag.get("results", []))
        url = pag.get("next")
    if esperado is not None and len(resultados) != esperado:
        sys.exit(f"ERROR: Kobo dijo que hay {esperado} reportes y llegaron {len(resultados)}. No se escribe nada.")
    return resultados


def leer_archivo(ruta):
    with open(ruta, encoding="utf-8") as f:
        datos = json.load(f)
    return datos.get("results", []) if isinstance(datos, dict) else datos


# ======================================================================
# PROCESO PRINCIPAL
# ======================================================================

def procesar(r, veredas):
    """Devuelve (feature, None) si se publica, o (None, motivo) si se omite."""
    # 1) Aprobacion humana
    estado = (r.get("_validation_status") or {}).get("uid")
    if estado != ESTADO_APROBADO:
        return None, "sin_aprobar"

    # 2) Autorizacion de la persona (vacio o raro = no se publica)
    consent = valor(r, "grp_consentimiento", "autoriza_publicacion")
    if consent not in CONSENTIMIENTOS_PUBLICABLES:
        return None, "sin_autorizacion_o_solo_interno"

    # 3) Ubicacion
    ll = obtener_latlon(r)
    if ll is None:
        return None, "sin_gps"
    lat, lon = ll
    vereda_pub = None
    if consent == "generalizada":
        centro = centro_de_vereda(lat, lon, veredas)
        if centro is None:
            return None, "generalizada_sin_vereda"
        lat_pub, lon_pub, vereda_pub = centro
        if abs(lat_pub - lat) < 1e-7 and abs(lon_pub - lon) < 1e-7:
            return None, "generalizada_igual_al_punto"
    else:
        lat_pub, lon_pub = round(lat, DECIMALES_EXACTA), round(lon, DECIMALES_EXACTA)
        vereda_pub = texto(valor(r, "grp_ubicacion", "vereda"), MAX_TEXTO_CORTO)

    # 4) Campos publicos (lista blanca)
    tipos = [t for t in lista(valor(r, "grp_evento", "tipo_afectacion")) if t in TIPOS]
    fecha_evento = valor(r, "grp_evento", "fecha_hora_evento")
    notif = valor(r, "grp_notificacion", "notificacion_previa")
    props = {
        "id": id_publico(r),
        "ubicacion": consent,
        "municipio": MUNICIPIOS.get(valor(r, "grp_ubicacion", "municipio")),
        "vereda": vereda_pub,
        "tipos": tipos,
        "tipos_texto": ", ".join(TIPOS[t] for t in tipos),
        "tipo_otro": texto(valor(r, "grp_evento", "tipo_afectacion_otro"), MAX_TEXTO_CORTO),
        "fecha": fecha_evento[:10] if isinstance(fecha_evento, str) else None,
        "descripcion": texto(valor(r, "grp_evento", "descripcion")),
        "titulo_asociado": texto(valor(r, "grp_ubicacion", "titulo_asociado"), 60),
        "notificado": {"si": "Sí", "no": "No"}.get(notif),
        "entidades": [ENTIDADES[e] for e in lista(valor(r, "grp_notificacion", "entidad_notificada")) if e in ENTIDADES],
        "fecha_notificacion": valor(r, "grp_notificacion", "fecha_notificacion"),
        "respuesta": RESPUESTAS.get(valor(r, "grp_notificacion", "respuesta_obtenida")),
        "ph": numero(valor(r, "grp_agua", "ph")),
        "turbidez_ntu": numero(valor(r, "grp_agua", "turbidez_ntu")),
        "conductividad_us": numero(valor(r, "grp_agua", "conductividad_us")),
    }
    props = {k: v for k, v in props.items() if v not in (None, "", [])}

    # 5) Revision anti-fuga sobre lo que se va a publicar
    publicado = json.dumps(props, ensure_ascii=False)
    publicado_min = publicado.lower()
    secretos = [str(valor(r, g, c)).lower() for g, c in CAMPOS_PRIVADOS if valor(r, g, c)]
    secretos.append(str(r.get("_submitted_by") or "").lower())
    for s in secretos:
        if len(s) >= 4 and s in publicado_min:
            return None, "REVISAR_dato_privado_copiado_en_texto"
    textos_libres = " ".join(str(props.get(k, "")) for k in ("descripcion", "tipo_otro", "titulo_asociado"))
    if RE_TELEFONO.search(textos_libres):
        return None, "REVISAR_telefono_en_texto"
    if consent == "generalizada" and RE_COORDENADA.search(textos_libres):
        return None, "REVISAR_coordenada_en_texto"

    feature = {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": [round(lon_pub, 6), round(lat_pub, 6)]},
        "properties": props,
    }
    return feature, None


def main():
    ap = argparse.ArgumentParser(description="Genera el GeoJSON publico de reportes.")
    ap.add_argument("--entrada", help="JSON local de Kobo (modo prueba, sin internet)")
    ap.add_argument("--veredas", default="data/veredas.geojson")
    ap.add_argument("--salida", default="data/reportes_publicos.geojson")
    ap.add_argument("--fotos-dir", default="data/fotos")
    args = ap.parse_args()

    modo_prueba = bool(args.entrada)
    if modo_prueba:
        registros = leer_archivo(args.entrada)
        token = None
    else:
        try:
            token = os.environ["KOBO_TOKEN"]
            uid = os.environ["KOBO_ASSET_UID"]
        except KeyError as e:
            sys.exit(f"ERROR: falta la variable {e}. En GitHub: Settings -> Secrets and variables -> Actions.")
        servidor = os.environ.get("KOBO_SERVER", "https://kf.kobotoolbox.org")
        registros = leer_kobo(servidor, uid, token)

    publicar_fotos = os.environ.get("PUBLICAR_FOTOS", "0") == "1" and not modo_prueba
    if os.environ.get("PUBLICAR_FOTOS", "0") == "1" and modo_prueba:
        print("AVISO: en modo prueba no se descargan fotos.")

    veredas = cargar_veredas(args.veredas)
    carpeta_fotos = Path(args.fotos_dir)
    features, omitidos, fotos_conservar = [], Counter(), set()

    for r in registros:
        feature, motivo = procesar(r, veredas)
        if feature is None:
            omitidos[motivo] += 1
            continue
        if publicar_fotos and feature["properties"]["ubicacion"] == "exacta":
            try:
                rutas = guardar_fotos(r, feature["properties"]["id"], token, carpeta_fotos)
            except Exception as e:      # una foto que falla no debe tumbar todo, pero se avisa
                print(f"AVISO: fallo al procesar fotos de {feature['properties']['id']}: {type(e).__name__}")
                rutas = []
            if rutas:
                feature["properties"]["fotos"] = rutas
                fotos_conservar.update(Path(x).name for x in rutas)
        features.append(feature)

    features.sort(key=lambda f: (f["properties"].get("fecha", ""), f["properties"]["id"]))
    salida = {"type": "FeatureCollection", "features": features}

    destino = Path(args.salida)
    destino.parent.mkdir(parents=True, exist_ok=True)
    tmp = destino.with_suffix(destino.suffix + ".tmp")
    tmp.write_text(json.dumps(salida, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(destino)

    if not modo_prueba:
        borrar_fotos_huerfanas(carpeta_fotos, fotos_conservar)

    print(f"Reportes recibidos: {len(registros)} | publicados: {len(features)} | omitidos: {sum(omitidos.values())}")
    for motivo, n in sorted(omitidos.items()):
        print(f"   - {motivo}: {n}")
    if any(m.startswith("REVISAR") for m in omitidos):
        print("   >> Hay reportes marcados REVISAR: alguien del equipo debe leerlos y corregir el texto en Kobo.")


if __name__ == "__main__":
    main()
