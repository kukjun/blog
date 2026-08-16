/**
 * blog-views — 조회수 카운터 (내 소유 백엔드)
 * Cloudflare Worker + KV. 데이터는 내 Cloudflare 계정 KV에 남는다(소유).
 *
 * 엔드포인트:
 *   GET  /views/:key   → 증가 없이 현재 카운트 조회   { key, count }
 *   POST /views/:key   → 1 증가 후 카운트 반환        { key, count }
 *   OPTIONS            → CORS preflight
 *
 * 주의: KV는 결과적 일관성(eventual consistency)이라 동시 증가 시 드물게
 * 유실될 수 있음. 개인 블로그 규모엔 충분. 원자적 카운트가 필요하면
 * Durable Objects로 승급.
 */

export interface Env {
  VIEWS: KVNamespace;
}

// 허용 오리진(프론트). 로컬 프리뷰 + GitHub Pages + (나중에) 커스텀 도메인.
const ALLOW_ORIGINS = [
  'https://kukjun.github.io',
  'https://kukjun.dev',
  'http://localhost:4321',
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOW_ORIGINS.includes(origin) ? origin : ALLOW_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const origin = req.headers.get('Origin');
    const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin) };

    if (req.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    const url = new URL(req.url);
    const match = url.pathname.match(/^\/views\/(.+)$/);
    if (!match) {
      return new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers });
    }

    const rawKey = decodeURIComponent(match[1]);
    // 키 위생: 길이 제한 + 안전 문자만(임의 키로 KV 오염 방지)
    if (rawKey.length > 128 || !/^[\w./:-]+$/.test(rawKey)) {
      return new Response(JSON.stringify({ error: 'bad_key' }), { status: 400, headers });
    }
    const storeKey = 'views:' + rawKey;

    let count = parseInt((await env.VIEWS.get(storeKey)) || '0', 10);
    if (!Number.isFinite(count) || count < 0) count = 0;

    if (req.method === 'POST') {
      count += 1;
      await env.VIEWS.put(storeKey, String(count));
    } else if (req.method !== 'GET') {
      return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405, headers });
    }

    return new Response(JSON.stringify({ key: rawKey, count }), { headers });
  },
};
