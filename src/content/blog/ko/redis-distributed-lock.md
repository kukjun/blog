---
title: "시간이 겹치는 예약은 UNIQUE로 막을 수 있을까요"
description: "트랜잭션 안에서 중복을 조회해도 두 예약이 함께 저장될 수 있었어요. 실제 PostgreSQL에서 시간 구간의 경쟁을 만들고, UNIQUE와 구간 배제 제약이 각각 무엇을 막는지 확인했습니다."
pubDate: 2024-05-25
updatedDate: 2026-09-14
lang: ko
tags: ["동시성", "Redis", "PostgreSQL", "데이터베이스"]
translationKey: "redis-distributed-lock"
draft: false
---

예약 기능을 만들면서, 중복 조회와 저장을 트랜잭션으로 묶으면 동시 요청에도 안전한지 확인하고 싶었습니다. [2024년 5월 원문](https://velog.io/@imkkuk/Redis%EB%A1%9C-%EB%8F%99%EC%8B%9C%EC%84%B1-%EB%AC%B8%EC%A0%9C-%ED%95%B4%EA%B2%B0%ED%95%98%EA%B8%B0)은 사이드 프로젝트에서 동시성 문제가 생길 수 있는 부분을 찾아보자는 질문으로 시작해요. 이미 발생한 고객 사고를 회고한 글은 아니었습니다.

원문에는 요청 하나, 시간차를 둔 두 요청, 거의 동시에 들어온 두 요청의 SQL 순서가 있습니다. 마지막 경우에는 두 요청이 모두 중복 예약을 찾지 못한 뒤 각자 저장하고 커밋했습니다. 당시에는 검사와 저장 앞에 Redis 락을 두는 방법을 적용했다고 기록했습니다.

다시 보니 예약의 조건부터 정확하게 써야 했어요. 시작 시각과 종료 시각이 모두 같은 예약만 막는 것이 아닙니다. 같은 자원에 `10:00~11:00`과 `10:30~11:30`을 동시에 예약할 수 없어야 합니다. 시작과 종료가 달라도 시간 구간은 겹칩니다.

## 먼저 “겹침”을 식으로 정했습니다

예약 구간은 시작을 포함하고 종료를 제외하는 `[start, end)`로 정했습니다. `10:00~11:00` 다음의 `11:00~12:00`은 허용하려는 규칙이에요. 두 구간이 겹치는 조건은 아래와 같습니다.

```sql
existing.starts_at < requested.ends_at
AND existing.ends_at > requested.starts_at
```

2026년 9월 14일에 **PostgreSQL 18.4와 pg 8.16.3**으로 이 조건을 새로 실행했습니다. 당시 Redis 구현의 부하 시험이 아니라, 같은 시간 구간 규칙을 DB에 표현하면 어떤 차이가 생기는지 확인하는 실험입니다. 별도의 실제 연결 두 개를 사용했고 격리 수준은 `READ COMMITTED`로 고정했습니다.

실험에는 같은 자원에 넣을 두 구간을 사용했습니다. 날짜는 임의의 테스트 데이터이며 시간대 해석을 피하려고 UTC를 명시했어요.

```text
A: resource_id=1, [2030-01-01 10:00Z, 11:00Z)
B: resource_id=1, [2030-01-01 10:30Z, 11:30Z)
```

## BEGIN이 두 요청의 검사와 저장을 한 줄로 세워주지는 않았어요

두 연결에서 먼저 트랜잭션을 시작하고, 어느 쪽도 쓰기 전에 겹치는 예약을 조회하도록 순서를 고정했습니다.

```sql
SELECT count(*)
FROM reservation_none
WHERE resource_id = $1
  AND starts_at < $3::timestamptz
  AND ends_at > $2::timestamptz;
```

여기서 `$2`는 요청의 시작, `$3`은 종료입니다. 두 연결 모두 0을 반환한 것을 확인한 뒤 A와 B가 각각 예약을 넣었습니다. B, A 순서로 커밋하고 별도 연결에서 최종 행 수를 읽었어요. 결과는 2개였습니다.

| 순서 | 연결 A | 연결 B |
| --- | --- | --- |
| 1 | `BEGIN` | `BEGIN` |
| 2 | 겹치는 예약 조회: 0 | 겹치는 예약 조회: 0 |
| 3 | A 구간 `INSERT` | B 구간 `INSERT` |
| 4 | `COMMIT` | `COMMIT` |

트랜잭션은 각 요청의 작업을 함께 확정하거나 취소할 수 있게 합니다. 하지만 두 읽기가 모두 통과한 후 어느 쓰기를 거절할지는 이 코드에 없습니다. 이 실험의 일반 `SELECT`는 빈 시간 구간을 다른 요청에게 예약해 주지 않습니다. `SERIALIZABLE`이나 별도의 잠금을 적용한 경우는 이번 결과와 구별해야 합니다.

## 시작과 종료에 UNIQUE를 걸어도 결과는 같았습니다

같은 실험을 아래 제약이 있는 테이블에서 반복했습니다.

```sql
UNIQUE (resource_id, starts_at, ends_at)
```

A와 B는 시작과 종료 시각이 다르므로 두 행 모두 저장됐습니다. 완전히 같은 A 구간을 한 번 더 넣으면 `23505`라는 unique 위반 오류가 났고요. 제약이 동작하지 않는 것이 아니라 **동일한 값과 겹치는 구간이 다른 조건**이었던 겁니다.

이 차이를 건너뛰고 `(자원, 시간대)` UNIQUE를 해결책으로 쓰려면 시간대를 고정된 슬롯으로 바꾸는 모델 변경부터 설명해야 합니다. 이번에는 원문의 임의 시작과 종료 구간을 유지했습니다.

## 겹침 자체를 거절하는 제약을 넣었습니다

PostgreSQL은 범위 타입과 배제 제약으로 “두 행이 이 관계를 동시에 만족하면 저장할 수 없다”를 표현할 수 있습니다. `btree_gist`는 자원 ID의 동등 비교를 범위의 겹침 비교와 함께 GiST 제약에 넣기 위해 사용했습니다.

```sql
CREATE EXTENSION btree_gist;

CREATE TABLE reservation_exclude (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  resource_id integer NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  CHECK (starts_at < ends_at),
  EXCLUDE USING gist (
    resource_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
);
```

`resource_id WITH =`와 구간의 `WITH &&`가 동시에 참인 두 행을 금지합니다. 같은 자원이고 시간이 겹치면 충돌하는 거예요. `NOT NULL`과 시작이 종료보다 앞서야 한다는 `CHECK`도 함께 두었습니다. 비어 있는 구간을 예약으로 넣지 않기 위해서입니다.

이번에도 사전 조회는 양쪽 모두 0이었습니다. A가 먼저 `INSERT`한 후 아직 커밋하지 않은 동안 B의 `INSERT`를 보냈습니다. 그때 B가 A를 기다리는 것을 `pg_blocking_pids()`로 확인했어요. A를 커밋하자 B는 `23P01`, 즉 exclusion 제약 위반으로 실패했습니다. B를 롤백한 뒤 최종 행은 하나였습니다.

```text
A INSERT, 아직 미커밋
B INSERT, A의 종료를 기다림
A COMMIT
B INSERT 실패: SQLSTATE 23P01
B ROLLBACK
별도 연결에서 COUNT(*) = 1
```

겹침 조회를 더 빨리 실행해서 해결된 것이 아닙니다. 쓰기를 받아들이는 지점에서 같은 규칙을 검사하게 바뀌었습니다. 사전 조회는 빠른 안내에 사용할 수 있지만, 그 결과만 믿고 최종 쓰기 충돌 처리를 생략하면 안 됩니다. 애플리케이션에서는 `23P01`을 잡아 “해당 시간에 예약할 수 없음” 같은 도메인 응답으로 연결해야 합니다. 이번 예제는 SQL 오류와 롤백까지 확인하며 HTTP 응답 계층은 포함하지 않습니다.

## 어느 규칙을 확인했는지 결과로 남겼습니다

| 조건 | 직접 확인한 결과 |
| --- | --- |
| 무제약, 겹치는 두 구간 | 조회는 모두 0, 최종 2행 |
| 시작과 종료에 UNIQUE, 겹치는 두 구간 | 조회는 모두 0, 최종 2행 |
| 같은 UNIQUE 테이블에 완전히 같은 구간 재입력 | `23505`로 거절 |
| 배제 제약, 같은 자원의 겹치는 두 구간 | B가 대기한 뒤 `23P01`, 최종 1행 |
| 배제 제약, 같은 자원의 바로 다음 구간 | 저장 성공 |
| 배제 제약, 다른 자원의 겹치는 구간 | 저장 성공 |
| 시작과 종료가 같은 빈 구간 | `23514`로 거절 |

당시에 왜 DB 제약 대신 Redis가 필요했는지를 확정할 자료는 원문에 없습니다. 여러 DB를 함께 수정하거나 외부 작업까지 묶어야 했다는 조건을 새로 보태지는 않겠습니다. 이번에 답한 질문은 한 DB에 저장하는 예약의 시간 구간이 겹치지 않게 만드는 방법입니다.

취소된 예약을 남길지, 자원의 수용량이 여러 개인지, 대기 예약이 자리를 점유하는지는 이 스키마에 넣지 않았습니다. 그런 규칙이 있다면 제약 대상도 달라집니다. 그래도 이번 결과는 중복 조회를 트랜잭션에 넣었다는 사실에서 한 걸음 더 나아가, 지키려는 관계가 실제 DB 제약으로 표현됐는지 확인할 수 있게 해줍니다.

## 직접 실행하려면

[전체 재현 코드](/blog/examples/database-transactions.mjs)는 실제 PostgreSQL 서버를 임시 디렉터리와 개인 Unix 소켓에서 실행합니다. 기존 DB와 TCP 포트는 사용하지 않고, 끝나면 서버와 데이터를 정리해요. Node.js 24.15.0, macOS arm64에서 실행했습니다. 출력의 `reservations` 항목에서 제약별 결과와 경계 조건을 확인할 수 있습니다.

```bash
work="$(mktemp -d)"
npm install --prefix "$work" embedded-postgres@18.4.0-beta.17 pg@8.16.3
BLOG_DB_NODE_MODULES="$work/node_modules" node public/examples/database-transactions.mjs
```

예제 파일만 내려받았다면 마지막 경로를 받은 파일 위치로 바꾸면 됩니다. 이 코드는 처리량 측정용이 아닙니다. 양쪽 조회가 모두 끝난 뒤 쓰도록 실행 순서를 정하고, 배제 제약에서는 실제 대기를 관찰해 충돌 경로를 확인합니다.

## 참고한 자료

- [Range Types: Constraints on Ranges](https://www.postgresql.org/docs/18/rangetypes.html#RANGETYPES-CONSTRAINT) (PostgreSQL 18): 범위의 동일성과 겹침, 자원별 배제 제약
- [Constraints](https://www.postgresql.org/docs/18/ddl-constraints.html) (PostgreSQL 18): UNIQUE, CHECK, 배제 제약의 역할
- [Transaction Isolation](https://www.postgresql.org/docs/18/transaction-iso.html) (PostgreSQL 18): 읽기 격리와 동시 트랜잭션
- [Error Codes](https://www.postgresql.org/docs/18/errcodes-appendix.html) (PostgreSQL 18): `23505`, `23P01`, `23514`의 의미
