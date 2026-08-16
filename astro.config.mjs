// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// GitHub Pages 프로젝트 페이지: https://kukjun.github.io/blog/
// 나중에 kukjun.dev 커스텀 도메인 붙이면 → site를 'https://kukjun.dev'로, base를 '/'로 바꾸고
// public/CNAME 추가 (아래 배포 워크플로가 CNAME도 함께 배포).
const SITE = 'https://kukjun.github.io';
const BASE = '/blog';

// https://astro.build/config
export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'ignore',
  i18n: {
    locales: ['en', 'ko'],
    defaultLocale: 'en',
    routing: {
      prefixDefaultLocale: true, // /en/ 과 /ko/ 둘 다 명시적 (기본언어도 접두사)
    },
  },
  integrations: [sitemap()],
});
