// 조회수 카운터 Worker 엔드포인트.
// wrangler 배포 후 나온 URL(https://blog-views.<subdomain>.workers.dev)로 교체.
// 빈 문자열이면 조회수 위젯은 조용히 비활성(에러 없음).
// 빌드 시 PUBLIC_VIEWS_API 환경변수가 있으면 그걸 우선 사용.
export const VIEWS_API: string =
  import.meta.env.PUBLIC_VIEWS_API ?? 'https://blog-views.lxx3380.workers.dev';

// 정체성·연락처 (한 곳에서 관리 → 헤더·푸터·홈 About에서 참조)
export const IDENTITY = {
  displayName: 'Kukjun (Jude) Lee',
  github: 'https://github.com/kukjun',
  linkedin: 'https://www.linkedin.com/in/kkuk/',
  email: 'lxx3380@gmail.com',
};

