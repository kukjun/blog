# blog-views (Cloudflare Worker + KV)

내 소유 조회수 카운터 백엔드. 데이터는 **내 Cloudflare 계정 KV**에 남는다(소유).

## 배포 (최초 1회)

```sh
cd worker
npm install
npx wrangler login                         # 브라우저 인증(내 Cloudflare 계정)
npx wrangler kv namespace create VIEWS     # → 출력된 id 를 wrangler.toml 의 id= 에 붙여넣기
npx wrangler deploy                        # → https://blog-views.<subdomain>.workers.dev 출력
```

배포 후 나온 URL을 블로그 빌드에 알려준다(둘 중 하나):
- `blog/.env` 에 `PUBLIC_VIEWS_API=https://blog-views.<subdomain>.workers.dev`, 또는
- `blog/src/siteconfig.ts` 의 기본값 교체.

그리고 `worker/src/index.ts` 의 `ALLOW_ORIGINS` 에 프론트 오리진이 포함돼야 함
(기본: `kukjun.github.io`, `kukjun.dev`, `localhost:4321`).

## 엔드포인트
- `GET  /views/:key` → 증가 없이 조회 `{ key, count }`
- `POST /views/:key` → 1 증가 후 반환 `{ key, count }`

`:key` = 글의 entry id(예: `en/why-the-machine`). 프론트는 같은 브라우저에서
이미 본 글이면 GET, 처음이면 POST(localStorage 플래그)로 인플레이션을 줄인다.

## 로컬 테스트
```sh
npx wrangler dev            # http://localhost:8787
curl -X POST http://localhost:8787/views/en/why-the-machine
```

## 비용
Cloudflare 무료tier: 10만 req/day, KV 10만 read·1천 write/day. 블로그엔 충분($0).
