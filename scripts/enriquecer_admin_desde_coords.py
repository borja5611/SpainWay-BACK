from __future__ import annotations

from pathlib import Path
import pandas as pd
import geopandas as gpd
from shapely.geometry import Point


BASE_DIR = Path(__file__).resolve().parent.parent
CSV_IN = BASE_DIR / "data" /  "NATIONAL_MASTER_POIS.csv"
CSV_OUT = BASE_DIR / "data" / "procesado" / "NATIONAL_MASTER_POIS_ENRIQUECIDO.csv"

# Municipios
SHP_MUNI_PEN = (
    BASE_DIR
    / "data"
    / "limites"
    / "SHP_ETRS89"
    / "recintos_municipales_inspire_peninbal_etrs89"
    / "recintos_municipales_inspire_peninbal_etrs89.shp"
)

SHP_MUNI_CAN = (
    BASE_DIR
    / "data"
    / "limites"
    / "SHP_REGCAN95"
    / "recintos_municipales_inspire_canarias_regcan95"
    / "recintos_municipales_inspire_canarias_regcan95.shp"
)

# Provincias
SHP_PROV_PEN = (
    BASE_DIR
    / "data"
    / "limites"
    / "SHP_ETRS89"
    / "recintos_provinciales_inspire_peninbal_etrs89"
    / "recintos_provinciales_inspire_peninbal_etrs89.shp"
)

SHP_PROV_CAN = (
    BASE_DIR
    / "data"
    / "limites"
    / "SHP_REGCAN95"
    / "recintos_provinciales_inspire_canarias_regcan95"
    / "recintos_provinciales_inspire_canarias_regcan95.shp"
)


def limpiar_texto(valor):
    if pd.isna(valor):
        return None
    texto = str(valor).strip()
    if not texto or texto.lower() in {"nan", "null", "none"}:
        return None
    return " ".join(texto.split())


def detectar_columna(candidatas, columnas):
    for c in candidatas:
        if c in columnas:
            return c
    return None


def leer_y_reproyectar(shp_path: Path) -> gpd.GeoDataFrame:
    if not shp_path.exists():
        raise FileNotFoundError(f"No existe el shapefile: {shp_path}")

    gdf = gpd.read_file(shp_path)

    if gdf.crs is None:
        raise ValueError(f"La capa {shp_path} no tiene CRS definido.")

    print(f"CRS original de {shp_path.name}: {gdf.crs}")
    gdf = gdf.to_crs("EPSG:4326")
    print(f"CRS reproyectado de {shp_path.name}: {gdf.crs}")

    return gdf


def cargar_capas(paths: list[Path]) -> gpd.GeoDataFrame:
    capas = [leer_y_reproyectar(p) for p in paths if p.exists()]
    if not capas:
        raise FileNotFoundError("No se encontró ninguna capa válida")
    gdf = pd.concat(capas, ignore_index=True)
    return gpd.GeoDataFrame(gdf, geometry="geometry", crs="EPSG:4326")


def cargar_municipios() -> gpd.GeoDataFrame:
    print("Cargando capas de municipios...")
    gdf = cargar_capas([SHP_MUNI_PEN, SHP_MUNI_CAN])

    print("Columnas disponibles en capa municipal:")
    print(list(gdf.columns))

    muni_col = detectar_columna(
        ["NAMEUNIT", "MUNICIPIO", "municipio", "NOMBRE", "nombre"],
        gdf.columns
    )

    if muni_col is None:
        raise ValueError(f"No se encontró columna de municipio. Columnas: {list(gdf.columns)}")

    gdf = gdf[[muni_col, "geometry"]].copy()
    gdf = gdf.rename(columns={muni_col: "MUNI_FROM_GEO"})
    return gdf


def cargar_provincias() -> gpd.GeoDataFrame:
    print("Cargando capas de provincias...")
    gdf = cargar_capas([SHP_PROV_PEN, SHP_PROV_CAN])

    print("Columnas disponibles en capa provincial:")
    print(list(gdf.columns))

    prov_col = detectar_columna(
        ["NAMEUNIT", "PROVINCIA", "provincia", "NOMBRE", "nombre"],
        gdf.columns
    )

    if prov_col is None:
        raise ValueError(f"No se encontró columna de provincia. Columnas: {list(gdf.columns)}")

    gdf = gdf[[prov_col, "geometry"]].copy()
    gdf = gdf.rename(columns={prov_col: "PROV_FROM_GEO"})
    return gdf


def spatial_fill(points_gdf: gpd.GeoDataFrame, polys_gdf: gpd.GeoDataFrame, out_col: str) -> pd.Series:
    print(f"Join espacial para {out_col} con within...")
    joined = gpd.sjoin(points_gdf, polys_gdf, how="left", predicate="within")

    pendientes = joined[joined[out_col].isna()].copy()
    print(f"Pendientes tras within para {out_col}: {len(pendientes)}")

    if len(pendientes) > 0:
        print(f"Segunda pasada nearest para {out_col}...")

        # Trabajamos solo con las filas pendientes
        pendientes_base = points_gdf.loc[pendientes.index].copy()

        # CRS proyectado para nearest en metros
        pendientes_proj = pendientes_base.to_crs("EPSG:3857")
        polys_proj = polys_gdf.to_crs("EPSG:3857")

        nearest = gpd.sjoin_nearest(
            pendientes_proj,
            polys_proj,
            how="left",
            distance_col="distancia_borde",
            lsuffix="poi",
            rsuffix="poly",
        )

        # Detectar el nombre real de la columna salida
        possible_cols = [
            out_col,
            f"{out_col}_poly",
            f"{out_col}_right",
            f"{out_col}_r",
        ]

        nearest_col = next((c for c in possible_cols if c in nearest.columns), None)

        if nearest_col is None:
            raise ValueError(
                f"No se encontró la columna '{out_col}' tras sjoin_nearest. "
                f"Columnas disponibles: {list(nearest.columns)}"
            )

        joined.loc[pendientes.index, out_col] = nearest[nearest_col].values

    return joined[out_col]


def main():
    print("Leyendo CSV...")
    df = pd.read_csv(CSV_IN, low_memory=False)
    df.columns = [c.strip() for c in df.columns]

    for col in ["LAT", "LON", "PROVINCE", "MUNICIPALITY"]:
        if col not in df.columns:
            raise ValueError(f"Falta columna requerida: {col}")

    print("Preparando columnas...")
    df["PROVINCE"] = df["PROVINCE"].apply(limpiar_texto)
    df["MUNICIPALITY"] = df["MUNICIPALITY"].apply(limpiar_texto)
    df["LAT"] = pd.to_numeric(df["LAT"], errors="coerce")
    df["LON"] = pd.to_numeric(df["LON"], errors="coerce")

    df_valid = df[df["LAT"].notna() & df["LON"].notna()].copy()
    print(f"Filas con coordenadas válidas: {len(df_valid)} / {len(df)}")

    geometry = [Point(xy) for xy in zip(df_valid["LON"], df_valid["LAT"])]
    gdf_pois = gpd.GeoDataFrame(df_valid, geometry=geometry, crs="EPSG:4326")

    gdf_muni = cargar_municipios()
    gdf_prov = cargar_provincias()

    muni_from_geo = spatial_fill(gdf_pois, gdf_muni, "MUNI_FROM_GEO")
    prov_from_geo = spatial_fill(gdf_pois, gdf_prov, "PROV_FROM_GEO")

    df_result = df.copy()

    # Rellenar solo donde falte, respetando índice
    muni_result = df_valid["MUNICIPALITY"].copy()
    prov_result = df_valid["PROVINCE"].copy()

    muni_result = muni_result.where(muni_result.notna(), muni_from_geo)
    prov_result = prov_result.where(prov_result.notna(), prov_from_geo)

    df_result.loc[df_valid.index, "MUNICIPALITY"] = muni_result
    df_result.loc[df_valid.index, "PROVINCE"] = prov_result

    prov_before = df["PROVINCE"].apply(limpiar_texto).isna().sum()
    muni_before = df["MUNICIPALITY"].apply(limpiar_texto).isna().sum()

    prov_after = df_result["PROVINCE"].apply(limpiar_texto).isna().sum()
    muni_after = df_result["MUNICIPALITY"].apply(limpiar_texto).isna().sum()

    print("Resumen:")
    print(f"PROVINCE nulos antes: {prov_before} ({prov_before / len(df) * 100:.4f}%)")
    print(f"PROVINCE nulos después: {prov_after} ({prov_after / len(df) * 100:.4f}%)")
    print(f"MUNICIPALITY nulos antes: {muni_before} ({muni_before / len(df) * 100:.4f}%)")
    print(f"MUNICIPALITY nulos después: {muni_after} ({muni_after / len(df) * 100:.4f}%)")

    CSV_OUT.parent.mkdir(parents=True, exist_ok=True)
    df_result.to_csv(CSV_OUT, index=False, encoding="utf-8")
    print(f"CSV enriquecido guardado en: {CSV_OUT}")


if __name__ == "__main__":
    main()