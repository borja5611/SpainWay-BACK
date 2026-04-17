from __future__ import annotations

import csv
import difflib
import re
import unicodedata
from pathlib import Path

import pandas as pd

# =========================================================
# RUTAS
# =========================================================
INPUT_MASTER = Path("data/procesado/NATIONAL_MASTER_POIS.csv")
INPUT_REF = Path("data/referencia/POIS_REFERENCIA_EXTERNOS.csv")

OUTPUT_MATCHED = Path("data/procesado/POIS_DESTACADOS_CCAA_MATCHED.csv")
OUTPUT_REVIEW = Path("data/procesado/POIS_DESTACADOS_CCAA_REVIEW.csv")

THRESHOLD_MATCH = 0.90


# =========================================================
# NORMALIZACIÓN
# =========================================================
def norm(text: str) -> str:
    if pd.isna(text):
        return ""
    text = str(text).strip().lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^a-z0-9\s]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def sim(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, norm(a), norm(b)).ratio()


# =========================================================
# LECTURA ROBUSTA DEL CSV DE REFERENCIA
# Arregla filas con comas extra metiéndolas en la última col.
# =========================================================
def load_reference_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"No existe el CSV de referencia: {path}")

    rows: list[list[str]] = []

    with path.open("r", encoding="utf-8-sig", newline="") as f:
        reader = csv.reader(f)
        all_rows = list(reader)

    if not all_rows:
        raise ValueError("El CSV de referencia está vacío")

    header = all_rows[0]
    expected_len = len(header)

    for i, row in enumerate(all_rows[1:], start=2):
        if not row or all(str(x).strip() == "" for x in row):
            continue

        if len(row) < expected_len:
            row = row + [""] * (expected_len - len(row))
        elif len(row) > expected_len:
            # todo lo sobrante lo metemos en la última columna
            row = row[: expected_len - 1] + [",".join(row[expected_len - 1 :])]

        rows.append(row)

    df = pd.DataFrame(rows, columns=header)
    return df


# =========================================================
# SCORING DE CANDIDATOS
# =========================================================
def score_candidate(ref_row: pd.Series, poi_row: pd.Series, aliases: list[str]) -> tuple[float, str]:
    poi_name = str(poi_row["NAME"])
    poi_name_norm = norm(poi_name)

    best_score = 0.0
    best_reason = "name_similarity"

    for alias in aliases:
        alias_norm = norm(alias)
        if not alias_norm:
            continue

        if alias_norm == poi_name_norm:
            score = 1.0
            reason = "exact_name"
        elif alias_norm in poi_name_norm or poi_name_norm in alias_norm:
            score = 0.96
            reason = "contains_name"
        else:
            score = sim(alias_norm, poi_name_norm)
            reason = "fuzzy_name"

        if score > best_score:
            best_score = score
            best_reason = reason

    ref_muni = norm(ref_row.get("municipio", ""))
    ref_prov = norm(ref_row.get("provincia", ""))

    poi_muni = norm(poi_row.get("MUNICIPALITY", ""))
    poi_prov = norm(poi_row.get("PROVINCE", ""))

    if ref_muni and ref_muni == poi_muni:
        best_score += 0.03
        best_reason += "+municipio"
    elif ref_prov and ref_prov == poi_prov:
        best_score += 0.015
        best_reason += "+provincia"

    return min(best_score, 1.0), best_reason


# =========================================================
# MAIN
# =========================================================
def main():
    if not INPUT_MASTER.exists():
        raise FileNotFoundError(f"No existe el master: {INPUT_MASTER}")

    print(f"[LOAD] Leyendo master: {INPUT_MASTER}")
    master = pd.read_csv(INPUT_MASTER)

    print(f"[LOAD] Leyendo referencias: {INPUT_REF}")
    ref = load_reference_csv(INPUT_REF)

    columnas_master_obligatorias = [
        "GLOBAL_ID",
        "NAME",
        "TYPE",
        "CATEGORY",
        "CCAA",
        "PROVINCE",
        "MUNICIPALITY",
        "VALID",
    ]

    faltan_master = [c for c in columnas_master_obligatorias if c not in master.columns]
    if faltan_master:
        raise ValueError(f"Faltan columnas en master: {faltan_master}")

    columnas_ref_obligatorias = [
        "ccaa",
        "provincia",
        "municipio",
        "poi_canonico",
        "alias_1",
        "alias_2",
        "fuente",
        "fuente_tipo",
        "url_fuente",
        "prioridad_fuente",
        "global_id_override",
        "notas",
    ]

    faltan_ref = [c for c in columnas_ref_obligatorias if c not in ref.columns]
    if faltan_ref:
        raise ValueError(f"Faltan columnas en referencias: {faltan_ref}")

    master = master.copy()
    master = master[
        (master["VALID"] == True)
        & master["CCAA"].notna()
        & master["NAME"].notna()
    ].copy()

    print(f"[INFO] POIs válidos en master: {len(master)}")
    print(f"[INFO] Filas en referencia: {len(ref)}")

    matched_rows = []
    review_rows = []

    for _, r in ref.iterrows():
        ccaa = str(r.get("ccaa", "")).strip()
        poi_canonico = str(r.get("poi_canonico", "")).strip()

        if not ccaa or not poi_canonico:
            continue

        provincia = str(r.get("provincia", "")).strip() if pd.notna(r.get("provincia")) else ""
        municipio = str(r.get("municipio", "")).strip() if pd.notna(r.get("municipio")) else ""
        override = str(r.get("global_id_override", "")).strip() if pd.notna(r.get("global_id_override")) else ""

        aliases = [poi_canonico]
        for col in ["alias_1", "alias_2"]:
            val = r.get(col)
            if pd.notna(val) and str(val).strip():
                aliases.append(str(val).strip())

        # =====================================================
        # 1) Si hay override manual, lo usamos directamente
        # =====================================================
        if override:
            poi_override = master[master["GLOBAL_ID"] == override]
            if len(poi_override) == 1:
                poi = poi_override.iloc[0]
                matched_rows.append({
                    **r.to_dict(),
                    "matched_global_id": poi["GLOBAL_ID"],
                    "matched_name": poi["NAME"],
                    "matched_ccaa": poi["CCAA"],
                    "matched_province": poi["PROVINCE"],
                    "matched_municipality": poi["MUNICIPALITY"],
                    "matched_type": poi["TYPE"],
                    "matched_category": poi["CATEGORY"],
                    "match_confianza": 1.0,
                    "match_reason": "manual_override",
                    "match_status": "matched",
                })
                continue

        # =====================================================
        # 2) Filtrar por CCAA
        # =====================================================
        subset = master[master["CCAA"].astype(str).str.strip() == ccaa].copy()

        # si la provincia existe y da candidatos, reducimos
        if provincia:
            subset_prov = subset[
                subset["PROVINCE"].astype(str).str.strip() == provincia
            ].copy()
            if len(subset_prov) > 0:
                subset = subset_prov

        # si el municipio existe y da candidatos, reducimos aún más
        if municipio:
            subset_muni = subset[
                subset["MUNICIPALITY"].astype(str).str.strip() == municipio
            ].copy()
            if len(subset_muni) > 0:
                subset = subset_muni

        if len(subset) == 0:
            review_rows.append({
                **r.to_dict(),
                "matched_global_id": "",
                "matched_name": "",
                "matched_ccaa": "",
                "matched_province": "",
                "matched_municipality": "",
                "matched_type": "",
                "matched_category": "",
                "match_confianza": 0.0,
                "match_reason": "no_candidates_in_master",
                "match_status": "review",
            })
            continue

        # =====================================================
        # 3) Buscar mejor candidato
        # =====================================================
        candidates = []
        for _, poi in subset.iterrows():
            score, reason = score_candidate(r, poi, aliases)
            candidates.append((score, reason, poi))

        candidates.sort(key=lambda x: x[0], reverse=True)
        best_score, best_reason, best_poi = candidates[0]

        result = {
            **r.to_dict(),
            "matched_global_id": best_poi["GLOBAL_ID"],
            "matched_name": best_poi["NAME"],
            "matched_ccaa": best_poi["CCAA"],
            "matched_province": best_poi["PROVINCE"],
            "matched_municipality": best_poi["MUNICIPALITY"],
            "matched_type": best_poi["TYPE"],
            "matched_category": best_poi["CATEGORY"],
            "match_confianza": round(float(best_score), 4),
            "match_reason": best_reason,
            "match_status": "matched" if best_score >= THRESHOLD_MATCH else "review",
        }

        if best_score >= THRESHOLD_MATCH:
            matched_rows.append(result)
        else:
            review_rows.append(result)

    OUTPUT_MATCHED.parent.mkdir(parents=True, exist_ok=True)

    pd.DataFrame(matched_rows).to_csv(
        OUTPUT_MATCHED, index=False, encoding="utf-8-sig"
    )
    pd.DataFrame(review_rows).to_csv(
        OUTPUT_REVIEW, index=False, encoding="utf-8-sig"
    )

    print(f"[OK] matched: {OUTPUT_MATCHED} ({len(matched_rows)} filas)")
    print(f"[OK] review : {OUTPUT_REVIEW} ({len(review_rows)} filas)")


if __name__ == "__main__":
    main()