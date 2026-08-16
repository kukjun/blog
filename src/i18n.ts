export type Lang = 'en' | 'ko';
export const LANGS: Lang[] = ['en', 'ko'];
export const DEFAULT_LANG: Lang = 'en';

export const ui = {
  en: {
    tagline: 'Building the machine, not just the product.',
    role: 'Production LLM Systems Engineer',
    posts: 'Writing',
    readMore: 'Read',
    backToList: '← All posts',
    noPosts: 'No posts yet — first one is on the way.',
    updated: 'Updated',
    otherLang: '한국어',
    views: 'views',
  },
  ko: {
    tagline: '제품이 아니라, 그걸 찍어내는 기계를 만든다.',
    role: '프로덕션 LLM 시스템 엔지니어',
    posts: '글',
    readMore: '읽기',
    backToList: '← 목록으로',
    noPosts: '아직 글이 없어요 — 첫 글이 곧 올라옵니다.',
    updated: '수정',
    otherLang: 'English',
    views: '조회',
  },
} as const;

export function t(lang: Lang) {
  return ui[lang];
}

// base('/blog/' 또는 '/')를 앞에 붙여 절대경로 링크를 만든다.
// 커스텀 도메인(base '/')으로 옮겨도 그대로 동작.
export function withBase(path: string): string {
  const base = import.meta.env.BASE_URL; // Astro가 정규화: "/blog/" 또는 "/"
  return ('/' + base + '/' + path).replace(/\/{2,}/g, '/');
}

// entry id "en/hello-world" → { lang, slug }
export function parseId(id: string): { lang: Lang; slug: string } {
  const [lang, ...rest] = id.split('/');
  return { lang: (lang as Lang), slug: rest.join('/') };
}

export function formatDate(d: Date, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === 'ko' ? 'ko-KR' : 'en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  }).format(d);
}
