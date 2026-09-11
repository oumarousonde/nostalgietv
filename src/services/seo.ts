import { prisma } from "../lib/prisma";

/**
 * IMPORTANT — lire avant de croire que le SEO est "fait" : ce sitemap liste les URLs
 * de pages publiques par série (ex. /series/les-mysteres-de-vertigo), mais CES PAGES
 * N'EXISTENT PAS ENCORE. Ce projet est une API + des maquettes HTML statiques, pas un
 * site avec des pages serveur réellement rendues par série. Un sitemap qui pointe vers
 * des URLs qui ne rendent rien ne sert à rien pour Google — voir docs/05-seo.md pour
 * ce qu'il manque réellement avant que ça marche.
 */
export async function generateSitemapXml(): Promise<string> {
  const baseUrl = process.env.PUBLIC_BASE_URL ?? "https://nostalgietv.example.com";

  const shows = await prisma.show.findMany({
    where: { communityCreated: false }, // les pistes non résolues n'ont pas vocation à être indexées
    select: { id: true, title: true, createdAt: true },
  });

  const urls = shows
    .map(
      (show) => `  <url>
    <loc>${baseUrl}/series/${slugify(show.title)}-${show.id}</loc>
    <lastmod>${show.createdAt.toISOString().slice(0, 10)}</lastmod>
  </url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // retire les accents
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
