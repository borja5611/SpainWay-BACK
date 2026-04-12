from pathlib import Path
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
CSV = BASE_DIR / "data" / "procesado" / "NATIONAL_MASTER_POIS_ENRIQUECIDO.csv"

df = pd.read_csv(CSV, low_memory=False)

for col in ["PROVINCE", "MUNICIPALITY"]:
    vacios = df[col].isna().sum() + (df[col].astype(str).str.strip() == "").sum()
    pct = vacios / len(df) * 100
    print(col, vacios, round(pct, 4))