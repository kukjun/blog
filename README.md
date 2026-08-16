# blog

Kukjun Lee의 개인 기술 블로그 — 소유 자산(오디언스·평판). Astro + i18n(en/ko).

## 스택
- **Astro 5** 정적 사이트, 콘텐츠 컬렉션(glob loader)
- **i18n**: `/en/`, `/ko/` (기본 en). UI 문자열 = `src/i18n.ts`
- **디자인**: 블루프린트 토큰(`src/styles/global.css`) — 전략문서와 동일 브랜드
- **SEO**: sitemap, 언어별 RSS(`/rss-en.xml`, `/rss-ko.xml`), canonical, OG

## 개발
```sh
npm install
npm run dev      # http://localhost:4321
npm run build    # dist/ 정적 출력
npm run preview
```

## 글 쓰기
`src/content/blog/{en,ko}/<slug>.md` 에 프론트매터와 함께.

```yaml
---
title: "..."
description: "..."
pubDate: 2026-08-16
lang: en            # en | ko (폴더와 일치)
tags: ["agents"]
translationKey: "why-the-machine"   # en/ko 번역 짝을 잇는 키 (같으면 서로 번역)
draft: false
---
```

- 같은 `translationKey` + 다른 `lang` → 글 하단에 🌐 언어 전환 링크 자동 노출.
- `draft: true` 면 빌드에서 제외.

## 배포 (TODO)
1. 도메인 확정 → `astro.config.mjs`의 `SITE` + `public/robots.txt` 교체.
2. Cloudflare Pages / Vercel 연결 (빌드: `npm run build`, 출력: `dist`).
3. dev.to / Hashnode에 canonical URL로 신디케이션(도달 확장).

## 원칙 (IP)
개인 시간·장비, 공개 지식 + 내 아이디어만. 회사/전직장의 코드·데이터·프롬프트·
수식·고객정보·비밀은 절대 쓰지 않는다(clean-room). 내부 벤치는 "internal"로 표기.
