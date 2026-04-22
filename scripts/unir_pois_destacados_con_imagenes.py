import csv
import re
import unicodedata
from pathlib import Path
from difflib import SequenceMatcher

BASE_CSV = Path(r"data\procesado\POIS_DESTACADOS_CCAA_REVISED.csv")
IMAGES_CSV = Path(r"data\procesado\POIS_DESTACADOS_CCAA_IMAGENES.csv")
OUTPUT_CSV = Path(r"data\procesado\POIS_DESTACADOS_CCAA_FINAL.csv")
UNMATCHED_CSV = Path(r"data\procesado\POIS_DESTACADOS_CCAA_SIN_IMAGEN.csv")

STOPWORDS = {
    "de", "del", "la", "las", "el", "los", "y", "e",
    "d", "l", "a", "al", "en", "da", "do"
}

COMMUNITY_EQUIV = {
    "andalucia": "andalucia",
    "asturias": "asturias",
    "baleares": "baleares",
    "illes balears": "baleares",
    "canarias": "canarias",
    "cantabria": "cantabria",
    "cataluna": "cataluna",
    "catalunya": "cataluna",
    "madrid": "madrid",
    "comunidad valenciana": "comunidad valenciana",
    "valencia": "comunidad valenciana",
    "pais vasco": "pais vasco",
    "euskadi": "pais vasco",
    "navarra": "navarra",
    "comunidad foral de navarra": "navarra",
    "castilla la mancha": "castilla la mancha",
    "castilla y leon": "castilla y leon",
    "aragon": "aragon",
    "extremadura": "extremadura",
    "galicia": "galicia",
}

MANUAL_ALIASES = {
    ("asturias", "santa maria del naranco"): "naranco",
    ("asturias", "san miguel de lillo"): "miguel lillo",
    ("asturias", "cueva de tito bustillo"): "tito bustillo",
    ("asturias", "cerro de santa catalina"): "santa catalina",
    ("asturias", "centro niemeyer"): "niemeyer",
    ("asturias", "museo del jurasico de asturias"): "jurasico",

    ("baleares", "castillo de bellver"): "bellver",
    ("baleares", "alcudia casco historico"): "alcudia",
    ("baleares", "ciutadella de menorca"): "ciudatella",

    ("canarias", "parque nacional del teide"): "teide",
    ("canarias", "parque nacional de la caldera de taburiente"): "caldera taburiente",

    ("cantabria", "san vicente de la barquera"): "san vicente",

    ("cataluna", "basilica de la sagrada familia"): "sagrada familia",
    ("cataluna", "palau de la musica catalana"): "palau musica",
    ("cataluna", "conjunto arqueologico de tarraco"): "tarraco",
    ("cataluna", "teatro museo dali"): "museo dali",
    ("cataluna", "iglesias romanicas del valle de boi"): "iglesias valle boi",

    ("comunidad valenciana", "ciudad de las artes y las ciencias"): "artes ciencias",
    ("comunidad valenciana", "teatro romano de sagunto"): "teatro sagunto",
    ("comunidad valenciana", "palmeral de elche"): "palmeral",

    ("madrid", "estadio santiago bernabeu"): "santiago bernabeu",
    ("madrid", "museo reina sofia"): "museo sofia",
    ("madrid", "museo thyssen bornemisza"): "museo thyssen",
    ("madrid", "palacio real de madrid"): "palacio real",

    ("andalucia", "puente nuevo de ronda"): "puente nuevo",
    ("andalucia", "parque nacional de donana"): "parque donana",
    ("andalucia", "albaicin"): "albaicin",
    ("andalucia", "museo picasso malaga"): "museo picasso malaga",
}

def limpiar(valor: str) -> str:
    return (valor or "").strip()

def normalize_text(value: str) -> str:
    value = limpiar(value).lower()
    value = unicodedata.normalize("NFD", value)
    value = "".join(ch for ch in value if unicodedata.category(ch) != "Mn")
    value = value.replace("&", " y ")
    value = re.sub(r"[^a-z0-9\s\-_]+", " ", value)
    value = value.replace("-", " ")
    value = value.replace("_", " ")
    value = re.sub(r"\s+", " ", value).strip()
    return value

def slugify(value: str) -> str:
    value = normalize_text(value)
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"-{2,}", "-", value).strip("-")
    return value

def normalize_tokens(value: str):
    return [t for t in normalize_text(value).split() if t and t not in STOPWORDS]

def token_key(value: str) -> str:
    return " ".join(sorted(normalize_tokens(value)))

def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, normalize_text(a), normalize_text(b)).ratio()

def comunidad_equivalente(value: str) -> str:
    v = normalize_text(value)
    return COMMUNITY_EQUIV.get(v, v)

def build_image_indexes(image_rows):
    by_exact = {}
    by_slug = {}
    by_token = {}
    by_community = {}

    for row in image_rows:
        comunidad = comunidad_equivalente(row["comunidad"])
        nombre = limpiar(row["poi_canonico"])
        imagen_url = limpiar(row["imagen_url"])

        by_exact[(comunidad, normalize_text(nombre))] = imagen_url
        by_slug[(comunidad, slugify(nombre))] = imagen_url
        by_token[(comunidad, token_key(nombre))] = imagen_url

        by_community.setdefault(comunidad, []).append({
            "poi_canonico": nombre,
            "imagen_url": imagen_url,
        })

    return by_exact, by_slug, by_token, by_community

def resolve_image(row, by_exact, by_slug, by_token, by_community):
    comunidad = comunidad_equivalente(row.get("ccaa") or row.get("comunidad") or "")
    poi_canonico = limpiar(row.get("poi_canonico", ""))
    matched_name = limpiar(row.get("matched_name", ""))

    candidate_names = [name for name in [poi_canonico, matched_name] if name]

    for name in candidate_names:
        alias_key = (comunidad, normalize_text(name))
        alias_target = MANUAL_ALIASES.get(alias_key)
        if alias_target:
            k1 = (comunidad, normalize_text(alias_target))
            if k1 in by_exact:
                return by_exact[k1], f"manual-alias:{alias_target}"

            k2 = (comunidad, slugify(alias_target))
            if k2 in by_slug:
                return by_slug[k2], f"manual-alias-slug:{alias_target}"

            k3 = (comunidad, token_key(alias_target))
            if k3 in by_token:
                return by_token[k3], f"manual-alias-token:{alias_target}"

    for name in candidate_names:
        key = (comunidad, normalize_text(name))
        if key in by_exact:
            return by_exact[key], "exact"

    for name in candidate_names:
        key = (comunidad, slugify(name))
        if key in by_slug:
            return by_slug[key], "slug"

    for name in candidate_names:
        key = (comunidad, token_key(name))
        if key in by_token:
            return by_token[key], "token"

    community_items = by_community.get(comunidad, [])
    best_url = ""
    best_score = 0.0
    best_name = ""

    for name in candidate_names:
        for item in community_items:
            score = similarity(name, item["poi_canonico"])
            if score > best_score:
                best_score = score
                best_url = item["imagen_url"]
                best_name = item["poi_canonico"]

    if best_score >= 0.86:
        return best_url, f"fuzzy:{best_score:.2f}:{best_name}"

    return "", ""

def main():
    if not BASE_CSV.exists():
        raise FileNotFoundError(f"No existe el CSV base: {BASE_CSV}")

    if not IMAGES_CSV.exists():
        raise FileNotFoundError(f"No existe el CSV de imágenes: {IMAGES_CSV}")

    with IMAGES_CSV.open("r", encoding="utf-8-sig", newline="") as f:
        image_rows = list(csv.DictReader(f))

    by_exact, by_slug, by_token, by_community = build_image_indexes(image_rows)

    with BASE_CSV.open("r", encoding="utf-8-sig", newline="") as f_in:
        reader = csv.DictReader(f_in)
        fieldnames = list(reader.fieldnames or [])

        if "imagen_url" not in fieldnames:
            fieldnames.append("imagen_url")
        if "image_match_method" not in fieldnames:
            fieldnames.append("image_match_method")

        rows_out = []
        unmatched = []

        for row in reader:
            imagen_url, method = resolve_image(row, by_exact, by_slug, by_token, by_community)
            row["imagen_url"] = imagen_url
            row["image_match_method"] = method
            rows_out.append(row)

            if not imagen_url:
                unmatched.append({
                    "ccaa": row.get("ccaa", row.get("comunidad", "")),
                    "poi_canonico": row.get("poi_canonico", ""),
                    "matched_name": row.get("matched_name", ""),
                })

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)

    with OUTPUT_CSV.open("w", encoding="utf-8", newline="") as f_out:
        writer = csv.DictWriter(f_out, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows_out)

    with UNMATCHED_CSV.open("w", encoding="utf-8", newline="") as f_un:
        writer = csv.DictWriter(f_un, fieldnames=["ccaa", "poi_canonico", "matched_name"])
        writer.writeheader()
        writer.writerows(unmatched)

    total = len(rows_out)
    con_imagen = sum(1 for row in rows_out if limpiar(row.get("imagen_url", "")) != "")
    sin_imagen = total - con_imagen

    print(f"✅ CSV final generado: {OUTPUT_CSV}")
    print(f"📄 Total filas: {total}")
    print(f"🖼️ Con imagen: {con_imagen}")
    print(f"⚠️ Sin imagen: {sin_imagen}")
    print(f"📝 Sin match exportados en: {UNMATCHED_CSV}")

if __name__ == "__main__":
    main()