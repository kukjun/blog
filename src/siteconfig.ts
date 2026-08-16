// 조회수 카운터 Worker 엔드포인트.
// wrangler 배포 후 나온 URL(https://blog-views.<subdomain>.workers.dev)로 교체.
// 빈 문자열이면 조회수 위젯은 조용히 비활성(에러 없음).
// 빌드 시 PUBLIC_VIEWS_API 환경변수가 있으면 그걸 우선 사용.
export const VIEWS_API: string =
  import.meta.env.PUBLIC_VIEWS_API ?? '';
