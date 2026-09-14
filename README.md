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

원래 동기는 기존 원문과 작업 기록, Git 이력에서 먼저 확인합니다. 기억이 나지 않는다는 이유로 새 실험의 목적을 당시 계기처럼 쓰지 않습니다. 같은 시기의 작업 기록이 있어도 그 작업 때문에 글을 썼다는 연결은 별도 근거가 필요합니다.

한국어 원고 한 편에서 동기, 문제 원인, 수정과 검증이 이어지는지 먼저 검토하고, 통과한 글의 영어판을 맞춥니다. 원인과 해결이 빠진 글을 한계 고지만 붙여 발행하지 않습니다. 자세한 문체와 편집 기준은 [CLAUDE.md](CLAUDE.md)를 따릅니다.

## 원고와 실행 예제

재작성한 여섯 주제는 LangGraph, 커넥션 풀의 트랜잭션 종료, 시간 구간 예약, 프롬프트 캐시 비용, 브라우저 세션 라우팅, statfs 숫자 변환입니다. 예제의 검증 범위와 실행 환경은 각 원고에 적습니다.

| 주제 | 실행 파일 | 확인하는 것 |
| --- | --- | --- |
| LangGraph | [langgraph-supersteps.py](public/examples/langgraph-supersteps.py) | 실제 LangGraph 런타임의 병렬 갱신과 실패 후 재개 |
| 트랜잭션과 예약 | [database-transactions.mjs](public/examples/database-transactions.mjs) | 실제 임시 PostgreSQL과 두 연결의 가시성, 시간 구간 제약 충돌 |
| 프롬프트 캐시 | [prompt-cache-cost.py](public/examples/prompt-cache-cost.py) | 공개 단가와 가상 토큰 원장의 비용 비교, 실제 청구 측정과 구별 |
| 브라우저 라우팅 | [browser-session-routing.mjs](public/examples/browser-session-routing.mjs) | 전용 브라우저를 소유한 두 worker의 요청과 세션 수명 |
| statfs | [statfs-width-repro.mjs](public/examples/statfs-width-repro.mjs), [statfs-width-shim.c](public/examples/statfs-width-shim.c) | 주입한 네이티브 입력을 실제 Bun과 Node 바인딩으로 비교 |

설치와 실행 명령은 파일 상단 및 각 원고에 있습니다. 버전을 고정한 예제이며 최초 실행에는 의존성 다운로드가 필요할 수 있습니다. DB 예제는 임시 서버와 개인 Unix 소켓을 사용하고, 브라우저 예제는 loopback 서버와 전용 임시 context를 사용합니다. statfs 예제는 macOS arm64, Node 24.15.0, Bun 1.3.14, clang으로 범위를 제한합니다. 모델 API나 사내 시스템을 호출하지 않습니다.

한국어와 대응 영어 원고는 같은 기술 주장과 실험 범위를 유지합니다. 비공개 원자료와 내부 편집 회고는 이 저장소 밖에 보관합니다.

## 배포

[GitHub Actions](.github/workflows/deploy.yml)가 `main` push 시 빌드하고 [GitHub Pages](https://kukjun.github.io/blog/)에 배포합니다. 경로의 base는 `/blog`이며, 한영 홈은 `/blog/ko/`, `/blog/en/`입니다. PR 작업 브랜치의 push는 이 배포를 실행하지 않습니다.

언어별 RSS는 `/blog/rss-ko.xml`, `/blog/rss-en.xml`에 생성됩니다. 홈 문구는 `src/i18n.ts`, 디자인 토큰은 `src/styles/global.css`, 사이트 설정은 `astro.config.mjs`에서 관리합니다.
