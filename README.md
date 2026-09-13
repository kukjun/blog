# blog

Kukjun Lee의 개인 기술 블로그. 코드와 관찰 결과를 통해 기술적인 문제와 해결 과정을 기록합니다. Astro와 한영 콘텐츠 컬렉션을 사용합니다.

## 개발

```sh
npm ci
npm run dev      # http://localhost:4321/blog/
ASTRO_TELEMETRY_DISABLED=1 npm run build
npm run preview
```

정적 출력은 `dist/`에 생성됩니다. 글을 대량으로 옮기거나 철회한 뒤에는 `ASTRO_TELEMETRY_DISABLED=1 npm run astro -- sync --force`로 콘텐츠 캐시를 갱신할 수 있습니다.

## 글 쓰기

원고는 `src/content/blog/{en,ko}/<slug>.md`에 작성합니다.

```yaml
---
title: "..."
description: "..."
pubDate: 2025-11-28
updatedDate: 2026-09-13
lang: ko
tags: ["LangGraph"]
translationKey: "langgraph-pregel"
featuredOrder: 1
draft: false
---
```

- 기존 글의 `pubDate`, slug, `translationKey`를 유지하고 개작 날짜를 `updatedDate`로 기록합니다.
- 같은 `translationKey`의 한영 공개 글은 서로 언어 전환 링크를 갖습니다.
- `featuredOrder`는 공개 기준을 통과한 대표 글에만 지정합니다. 대표 글 개수는 정하지 않습니다.
- `draft: true`인 글은 홈, 글 페이지, RSS와 sitemap에서 제외합니다. 공개 저장소의 파일이나 Git 이력을 비공개로 만드는 기능은 아닙니다.

## 발행 기준

회사나 제품의 비공개 구조를 몰라도 문제, 원인을 구별한 과정, 수정 또는 기각 결과를 이해하고 확인할 수 있어야 합니다. 실제 경험은 공개 가능한 당시 증거로, 새 실험은 실행 시점과 버전을 명시해서 씁니다. 새 실험을 과거 운영 성과의 증거로 사용하지 않습니다.

한국어 원고 한 편과 실행 결과를 먼저 검토하고, 통과한 글의 영어판을 맞춥니다. 원인과 해결이 빠진 글을 한계 고지만 붙여 발행하지 않습니다. 자세한 문체와 편집 기준은 [CLAUDE.md](CLAUDE.md)를 따릅니다.

공개 예제는 `public/examples/`에 둡니다. LangGraph 글의 실험은 다음 명령으로 검증합니다.

```sh
uv run --no-project public/examples/langgraph-supersteps.py
```

Python 3.11 계열과 주요 의존성 버전이 파일에 지정되어 있습니다. 최초 실행에는 다운로드가 필요할 수 있으며 모델 호출은 없습니다. 비공개 원자료와 내부 편집 회고는 이 저장소 밖에 보관합니다.

## 배포

[GitHub Actions](.github/workflows/deploy.yml)가 `main` push 시 빌드하고 [GitHub Pages](https://kukjun.github.io/blog/)에 배포합니다. 경로의 base는 `/blog`이며, 한영 홈은 `/blog/ko/`, `/blog/en/`입니다. PR 작업 브랜치의 push는 이 배포를 실행하지 않습니다.

언어별 RSS는 `/blog/rss-ko.xml`, `/blog/rss-en.xml`에 생성됩니다. 홈 문구는 `src/i18n.ts`, 디자인 토큰은 `src/styles/global.css`, 사이트 설정은 `astro.config.mjs`에서 관리합니다.
