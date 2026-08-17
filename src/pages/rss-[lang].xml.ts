import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import { LANGS, t, parseId, withBase, type Lang } from '../i18n';
import type { APIRoute } from 'astro';

export async function getStaticPaths() {
  return LANGS.map((lang) => ({ params: { lang } }));
}

export const GET: APIRoute = async ({ params, site }) => {
  const lang = params.lang as Lang;
  const tr = t(lang);
  const posts = await getCollection('blog', ({ data }) => !data.draft && data.lang === lang);

  return rss({
    title: `Kukjun Lee | ${tr.role}`,
    description: tr.tagline,
    site: site ?? 'https://example.com',
    items: posts
      .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
      .map((post) => ({
        title: post.data.title,
        description: post.data.description,
        pubDate: post.data.pubDate,
        link: withBase(`/${lang}/blog/${parseId(post.id).slug}/`),
      })),
  });
};
