# CLAUDE.md — 블로그 작업 지침

> 이 저장소(`kukjun/blog`)에서 작업하는 에이전트(Claude Code, Codex 등)를 위한 규칙.
> 이 블로그는 **개인 소유 자산**이다. Kukjun (Jude) Lee의 기술 블로그이자 오디언스·평판을 쌓는 창구.

## 무엇인가

- **URL**: https://kukjun.github.io/blog/ (GitHub Pages 프로젝트 페이지, `base: /blog`)
- **배포**: `main`에 push하면 GitHub Actions(`withastro/action`)가 자동 빌드 후 Pages 배포. 1~2분.
- **스택**: Astro 5 정적 사이트, content collections(glob loader), i18n **en/ko**(기본 en).
- **커스텀 도메인**: 나중에 `kukjun.dev` 붙이면 `astro.config`의 `SITE`를 `https://kukjun.dev`, `base`를 `/`로 바꾸고 `public/CNAME` 추가. 링크는 `withBase()` 헬퍼라 자동 대응.

## 글 쓰기

- 파일: `src/content/blog/{en,ko}/<slug>.md`. en과 ko는 **같은 slug**, 프론트매터의 `translationKey`가 같으면 서로 번역 짝(글 하단에 🌐 언어 전환 링크 자동 노출).
- 프론트매터:
  ```yaml
  title: "..."
  description: "..."
  pubDate: 2024-04-01        # velog 이관 글은 반드시 velog 원본 발행일. 오늘 날짜 금지.
  lang: en                  # en | ko (폴더와 일치)
  tags: ["...", "..."]
  translationKey: "slug"    # en/ko 짝을 잇는 키
  draft: false
  ```
- **mermaid**: ```mermaid 코드펜스로 작성하면 렌더된다(remark 변환 + 클라이언트 렌더, 테마 동기화). flowchart, sequenceDiagram OK. 노드 라벨 안에서도 중간점(·) 쓰지 말고 쉼표나 괄호로.
- 다이어그램 캡션은 `<span class="figcap">...</span>`.
- **표(table)**: 그냥 마크다운 표로 쓰면 된다. 빌드 시 `rehypeTableWrap`이 `<div class="table-scroll">`로 감싸서 긴 표는 가로 스크롤되고(칸이 안 눌림), 셀 테두리와 패딩, 헤더 배경, 짝수 행 음영으로 칸이 구분된다(`src/styles/global.css`). 표는 진짜 비교가 필요할 때만 쓰고, 셀 안 텍스트는 너무 길지 않게. 별도 마크업 필요 없음.

## ★ 글쓰기 기준 (가장 중요)

목표는 **"동료가 자기 경험을 말해주는 글"**이지, 잘 정리된 AI 에세이가 아니다.
레퍼런스 글: **`src/content/blog/{ko,en}/unclosed-transaction-pool.md`** (이 문체를 표준으로 삼는다).

### 내용 — 구체와 서사
- **구체 > 추상**: 실제 코드, 실제 로그, 실제 증상, 실제 숫자. "The textbook advice is…" 같은 일반론 도입부 금지.
- **서사 아크**: 상황 → 막힘(감정) → 조사와 막다른 길 → 단서 → 아하 → 해결 → 반성. 독자가 같이 헤매게.
- **공감**: 감정은 억지로 넣지 말고 문제에서 배어나오게. ("재시작하면 잠깐 괜찮아진다는 말에서 뭔가 감이 오실 거예요.")
- **추론 과정을 보여준다**: 격언만 던지지 말고 거기 도달한 과정을.
- 시니어 깊이는 유지하되 이야기로 벌어들인다.
- velog 이관 시 **원문의 맥락, 감정, 코드를 살리고** 그대로 복붙하지 않는다. clean-room(회사·고객명·수치 재현 금지).

### 한국어 문체 규칙 (필수)
1. **존댓말 대화체**. 문어체 "~다 / ~하라 / ~봐라" 금지. 독자에게 말 걸듯이.
2. **Em dash(—) 절대 금지**. 본문, 참고자료, 숫자 범위 전부. 숫자는 `20~30` 또는 "20에서 30".
3. **키워드 나열 시 중간점(·) 금지**. 쉼표, "와/과", "|"를 쓴다.
4. **해요체 : 습니다체 ≈ 5:5**로 자연스럽게 혼용. (한쪽으로 쏠리면 딱딱하거나 가벼워 보인다.)
5. 과잉 볼드, TL;DR 박스, 번호 매긴 격언 리스트, 삽입된 극적 감정 훅, 명령체 지양.

### 영어 문체 규칙
- **Em dash(—) 금지** (한국어와 동일). 쉼표, 세미콜론, 마침표로.
- 에세이체가 아니라 대화체(1인칭, "you know that feeling"). TL;DR 박스, 번호 격언 리스트, 과잉 볼드 지양.

### 마무리 & 참고자료
- 마무리는 번호 리스트 격언이 아니라 자연스러운 반성 한두 문단.
- 참고자료는 `## 참고한 자료`(ko) / `## References`(en). 링크는 `[제목](url) (출처): 설명` 형식. em dash 쓰지 않는다.

## 상호작용 기능
- **댓글 + GitHub 로그인 + 👍**: giscus (`src/components/Giscus.astro`). GitHub Discussions 기반.
- **조회수**: 내 소유 Cloudflare Worker + KV (`worker/`). URL은 `src/siteconfig.ts`의 `VIEWS_API`. Worker 코드 바꾸면 `cd worker && npx wrangler deploy`로 별도 재배포(내 Cloudflare 로그인 필요).
- **정체성**: `src/siteconfig.ts`의 `IDENTITY` 한 곳에서 관리(이름, GitHub, LinkedIn, Email).

## 로컬 개발
```sh
npm install
npm run dev       # http://localhost:4321/blog/
npm run build     # dist/
npm run preview
```
