/**
 * Normalisation des numéros de téléphone : tout est stocké au format international
 * (+22675318351) pour que "75 31 83 51", "75318351" et "+226 75 31 83 51" désignent
 * le MÊME compte. Hypothèse : un numéro à 8 chiffres sans indicatif est burkinabè (+226).
 */
export const DEFAULT_COUNTRY_CODE = "+226";

export function normalizePhone(raw: string): string | null {
  let s = String(raw ?? "").trim().replace(/[\s.\-()]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);

  if (!s.startsWith("+")) {
    if (/^\d{8}$/.test(s)) s = DEFAULT_COUNTRY_CODE + s; // numéro local burkinabè
    else if (/^226\d{8}$/.test(s)) s = "+" + s;
    else return null;
  }
  return /^\+\d{8,15}$/.test(s) ? s : null;
}

export function looksLikeEmail(value: string): boolean {
  return String(value ?? "").includes("@");
}
