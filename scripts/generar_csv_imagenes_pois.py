import csv
import re
import unicodedata
from pathlib import Path

IMAGES_ROOT = Path(r"C:\Users\borja\TFG\CODIGO\FRONT\public\pois-destacados")
OUTPUT_CSV = Path(r"data\procesado\POIS_DESTACADOS_CCAA_IMAGENES.csv")

COMMUNITY_NAME_MAP = {
    "andalucia": "Andalucía",
    "asturias": "Asturias",
    "baleares": "Baleares",
    "canarias": "Canarias",
    "cantabria": "Cantabria",
    "cataluna": "Cataluña",
    "madrid": "Madrid",
    "valencia": "Comunidad Valenciana",
}

# Alias editoriales → nombre real del archivo sin extensión
# Con esto resolvemos directamente los casos que te faltaban aunque el archivo
# tenga un nombre corto o simplificado.
MANUAL_FILENAME_ALIASES = {
    ("Andalucía", "Albaicín"): "albaicin",
    ("Andalucía", "Museo Picasso Málaga"): "museo-picasso-malaga",
    ("Andalucía", "Puente Nuevo de Ronda"): "puente-nuevo",
    ("Andalucía", "Parque Nacional de Doñana"): "parque-donana",
    ("Comunidad Valenciana", "Palmeral de Elche"): "palmeral",
}

def normalize_text(value: str) -> str:
    value = (value or "").strip().lower()
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
    value = re.sub(r"-{2,}", "-", value)
    return value.strip("-")

def humanize_slug(filename_stem: str) -> str:
    text = filename_stem.replace("-", " ").strip()
    return " ".join(word.capitalize() for word in text.split())

def add_row(rows: list[dict], comunidad: str, poi_canonico: str, comunidad_slug: str, filename: str):
    rows.append({
        "comunidad": comunidad,
        "poi_canonico": poi_canonico,
        "imagen_url": f"/pois-destacados/{comunidad_slug}/{filename}",
    })

def main():
    if not IMAGES_ROOT.exists():
        raise FileNotFoundError(f"No existe la carpeta de imágenes: {IMAGES_ROOT}")

    rows = []
    existing_files = {}

    for comunidad_dir in sorted(IMAGES_ROOT.iterdir()):
        if not comunidad_dir.is_dir():
            continue

        comunidad_slug = comunidad_dir.name.strip().lower()
        comunidad = COMMUNITY_NAME_MAP.get(comunidad_slug, humanize_slug(comunidad_slug))

        for file in sorted(comunidad_dir.iterdir()):
            if not file.is_file():
                continue

            if file.suffix.lower() != ".webp":
                continue

            poi_canonico = humanize_slug(file.stem)
            add_row(rows, comunidad, poi_canonico, comunidad_slug, file.name)

            existing_files[(comunidad, file.stem.lower())] = file.name

    # Añadir aliases manuales si el archivo existe
    for (comunidad, poi_canonico), stem_alias in MANUAL_FILENAME_ALIASES.items():
        comunidad_slug = None
        for slug, human_name in COMMUNITY_NAME_MAP.items():
            if human_name == comunidad:
                comunidad_slug = slug
                break

        if not comunidad_slug:
            continue

        filename = existing_files.get((comunidad, stem_alias.lower()))
        if filename:
            add_row(rows, comunidad, poi_canonico, comunidad_slug, filename)

    # Eliminar duplicados exactos comunidad + poi_canonico + imagen_url
    dedup = {}
    for row in rows:
        key = (
            row["comunidad"].strip().lower(),
            normalize_text(row["poi_canonico"]),
            row["imagen_url"].strip(),
        )
        dedup[key] = row

    final_rows = list(dedup.values())

    OUTPUT_CSV.parent.mkdir(parents=True, exist_ok=True)

    with OUTPUT_CSV.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["comunidad", "poi_canonico", "imagen_url"]
        )
        writer.writeheader()
        writer.writerows(final_rows)

    print(f"✅ CSV de imágenes generado: {OUTPUT_CSV}")
    print(f"📄 Total filas: {len(final_rows)}")

if __name__ == "__main__":
    main()