export function buildGoogleSearchUrl(params: {
  name: string;
  municipality?: string | null;
  province?: string | null;
  ccaa?: string | null;
}): string {
  const query = [
    params.name,
    params.municipality,
    params.province,
    params.ccaa,
    "España",
  ]
    .filter((v) => v && v.trim().length > 0)
    .join(" ");

  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}