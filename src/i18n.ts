export type Lang = 'en' | 'ko';
export const LANGS: Lang[] = ['en', 'ko'];
export const DEFAULT_LANG: Lang = 'en';

export const ui = {
  en: {
    tagline: 'Notes on agent execution, LLM serving, and backend deployment.',
    role: 'Production LLM Systems Engineer',
    posts: 'All writing',
    featured: 'Start here',
    featuredIntro: 'Technical questions explored through runnable code and observed results.',
    languageNames: { en: 'English', ko: 'In Korean' },
    readMore: 'Read',
    backToList: '← All posts',
    noPosts: 'No posts yet. The first one is on the way.',
    updated: 'Updated',
    otherLang: '한국어',
    views: 'views',
    bio: 'I build backends for agents and LLMs. I use code and experiments to explore technical questions and write down what the results show.',
  },
  ko: {
    tagline: '에이전트 실행 경계, LLM 서빙, 배포를 다루는 백엔드 엔지니어링 기록.',
    role: '프로덕션 LLM 시스템 엔지니어',
    posts: '전체 글',
    featured: '먼저 읽어볼 글',
    featuredIntro: '실행 코드와 관찰 결과로 기술적인 질문에 답하는 글입니다.',
    languageNames: { en: '영어', ko: '한국어' },
    readMore: '읽기',
    backToList: '← 목록으로',
    noPosts: '아직 글이 없어요. 첫 글이 곧 올라옵니다.',
    updated: '수정',
    otherLang: 'English',
    views: '조회',
    bio: '에이전트와 LLM을 위한 백엔드를 만듭니다. 코드와 실험으로 기술적인 질문을 확인하고, 결과에서 알게 된 것을 적어요.',
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
