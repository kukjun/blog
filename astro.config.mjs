// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// GitHub Pages 프로젝트 페이지: https://kukjun.github.io/blog/
// 나중에 kukjun.dev 커스텀 도메인 붙이면 → site를 'https://kukjun.dev'로, base를 '/'로 바꾸고
// public/CNAME 추가 (아래 배포 워크플로가 CNAME도 함께 배포).
const SITE = 'https://kukjun.github.io';
const BASE = '/blog';

// ```mermaid 코드펜스 → <pre class="mermaid"> 로 변환(클라이언트에서 렌더).
// 별도 의존성 없이 mdast를 직접 순회.
function remarkMermaid() {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const walk = (node) => {
    if (!node || !node.children) return;
    for (const child of node.children) {
      if (child.type === 'code' && child.lang === 'mermaid') {
        child.type = 'html';
        child.value = `<pre class="mermaid">${esc(child.value)}</pre>`;
      } else {
        walk(child);
      }
    }
  };
  return (tree) => walk(tree);
}

// https://astro.build/config
export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'ignore',
  markdown: {
    remarkPlugins: [remarkMermaid],
  },
  i18n: {
    locales: ['en', 'ko'],
    defaultLocale: 'en',
    routing: {
      prefixDefaultLocale: true, // /en/ 과 /ko/ 둘 다 명시적 (기본언어도 접두사)
    },
  },
  integrations: [sitemap()],
});
