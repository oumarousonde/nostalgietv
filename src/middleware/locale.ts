import { Request, Response, NextFunction } from "express";

export type Locale = "fr" | "en";
const SUPPORTED_LOCALES: Locale[] = ["fr", "en"];
const DEFAULT_LOCALE: Locale = "fr";

declare global {
  namespace Express {
    interface Request {
      locale: Locale;
    }
  }
}

/**
 * Priorité : ?lang=en explicite dans l'URL > en-tête Accept-Language du navigateur >
 * français par défaut. Le paramètre explicite passe en premier pour qu'un lien partagé
 * avec ?lang=en force la langue même si le navigateur du destinataire est configuré
 * différemment.
 */
export function detectLocale(req: Request, _res: Response, next: NextFunction) {
  const queryLang = req.query.lang;
  if (typeof queryLang === "string" && isSupportedLocale(queryLang)) {
    req.locale = queryLang;
    return next();
  }

  const acceptLanguage = req.headers["accept-language"];
  if (acceptLanguage) {
    const preferred = acceptLanguage.split(",")[0].split("-")[0].toLowerCase();
    if (isSupportedLocale(preferred)) {
      req.locale = preferred;
      return next();
    }
  }

  req.locale = DEFAULT_LOCALE;
  next();
}

function isSupportedLocale(value: string): value is Locale {
  return SUPPORTED_LOCALES.includes(value as Locale);
}
