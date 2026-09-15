---
title: "커넥션을 반환했는데, 트랜잭션은 끝나지 않았어요"
description: "스테이징에서 수정값이 연결마다 다르게 보였던 기록을 다시 읽고, 풀 반환과 트랜잭션 종료를 구별했습니다. PostgreSQL과 실제 드라이버로 미커밋 쓰기, 오래된 스냅샷, 정상 반환과 예외의 종료 경로를 확인합니다."
pubDate: 2024-04-01
updatedDate: 2026-09-14
lang: ko
tags: ["데이터베이스", "디버깅", "신뢰성", "트랜잭션"]
translationKey: "unclosed-transaction-pool"
draft: false
---

스테이징에서 값을 수정했는데, 같은 시각에 들어온 조회 요청들이 서로 다른 값을 받았습니다. 변경된 값을 받는 요청도 있었고 이전 값을 받는 요청도 있었어요. 캐시 설정을 확인하고 꺼 보아도 현상이 남았습니다. 왜 저장 결과가 요청마다 달라지는지 확인하려고 수정과 조회 지점에 로그를 추가했습니다.

[2024년 4월에 남긴 원문](https://velog.io/@imkkuk/Trouble-Shooting-%EC%A2%85%EB%A3%8C%ED%95%98%EC%A7%80-%EC%95%8A%EC%9D%80-Transaction%EC%9D%84-Connection-Pool%EB%A1%9C-%EB%B0%98%ED%99%98)에는 이후 로컬에서 SQL 로그를 켜고, 크론 작업의 `return` 분기가 커밋과 롤백을 모두 건너뛰는 것을 찾았다고 적혀 있습니다. `finally`에서 연결은 풀에 반환했지만 트랜잭션은 끝내지 않았습니다.

그 기록을 다시 보니 두 질문을 구별해야 했어요. 같은 연결에서만 수정값이 보인다면 쓰기가 아직 커밋되지 않았을 수 있습니다. 다른 연결에서 커밋한 새 값을 못 본다면 읽는 쪽이 예전 스냅샷을 유지하고 있을 수 있고요. 둘 다 “값이 돌아갔다”로 표현하면 확인해야 할 SQL 순서가 달라집니다.

## 풀에 돌려주는 것과 DB 작업을 끝내는 것은 달랐어요

당시 사용한 MariaDB와 TypeORM의 정확한 패치 버전은 원문에 없습니다. 그래서 현재 소스를 확인할 때도 버전을 고정했습니다. TypeORM **0.3.26**의 `MysqlQueryRunner.release()`는 드라이버 연결의 `release()`를 부릅니다. mysql2 **3.14.5**의 기본 반환 경로는 연결을 대기 요청에 넘기거나 유휴 목록에 넣어요. 이 경로에 `COMMIT`이나 `ROLLBACK`은 없습니다.

```text
QueryRunner.release()
  -> databaseConnection.release()
  -> pool.releaseConnection(connection)
  -> 대기 요청에 전달하거나 유휴 목록에 보관
```

이것은 특정 버전의 기본 소스를 읽은 결과입니다. 반환 때 세션을 초기화하는 다른 드라이버나 별도 훅까지 같은 동작이라고 할 수는 없어요. 당시 바이너리를 다시 실행한 증거도 아닙니다.

연결 반환이 트랜잭션에 미치는 영향을 직접 확인하려고, 2026년 9월 14일에 **PostgreSQL 18.4와 pg 8.16.3**으로 별도 실험을 했습니다. MariaDB 사고의 동일 환경 재현과는 구별합니다. 실제 DB 서버와 드라이버를 쓰고, 풀의 최대 연결을 1개로 제한해 다음 요청이 같은 연결을 빌리게 했어요. 별도의 관찰 연결도 하나 두었습니다.

## 수정한 사람만 새 값을 보는 경우

초기값은 200입니다. 첫 사용자가 `BEGIN`을 보내고 트랜잭션을 끝내지 않은 채 풀에 반환합니다. 다음 사용자는 트랜잭션을 직접 시작하지 않고 평소처럼 값을 수정해요.

```javascript
const first = await pool.connect();
await first.query('BEGIN');
first.release(); // 의도적으로 종료를 빠뜨린 실험 조건

const next = await pool.connect();
await next.query('UPDATE pool_value SET value = 300 WHERE id = 1');
```

`next`에게는 새 요청이어도 DB에는 같은 연결의 열린 트랜잭션입니다. 이 연결의 조회는 자신의 미커밋 쓰기를 읽어서 300을 반환했지만, 별도 연결은 200을 반환했습니다. `next`에서 `ROLLBACK`을 보낸 뒤에는 두 연결 모두 200을 읽었어요.

| 실행 순서 | 재사용한 연결 | 별도 연결 |
| --- | --- | --- |
| 열린 트랜잭션을 물려받아 300으로 수정 | 300 | 200 |
| 같은 연결에서 `ROLLBACK` | 200 | 200 |

이때 “조회에서 300을 봤다”는 사실은 커밋의 증거가 아닙니다. 값을 수정한 연결을 계속 뽑으면 저장된 것처럼 보이고, 다른 연결을 뽑으면 저장되지 않은 것처럼 보일 수 있어요. 수정 요청이 성공했다고 응답하는 시점과 DB 커밋 완료 시점을 함께 확인해야 하는 이유입니다.

## 쓰기가 커밋돼도 예전 값을 보는 경우

이번에는 읽는 쪽에 오래된 스냅샷을 남겼습니다. 초기값 100을 `REPEATABLE READ` 트랜잭션에서 한 번 읽은 뒤, 종료하지 않고 풀에 반환합니다. 별도 연결에서 200으로 수정하고 커밋한 다음 그 연결을 다시 빌려 읽었어요.

```javascript
const first = await pool.connect();
await first.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
await first.query('SELECT value FROM pool_value WHERE id = 1');
first.release();

await observer.query('UPDATE pool_value SET value = 200 WHERE id = 1');
const next = await pool.connect();
const result = await next.query('SELECT value FROM pool_value WHERE id = 1');
```

`pg_backend_pid()`로 풀에 반환하기 전과 다시 빌린 뒤가 같은 DB 세션임을 확인했습니다. 새 사용자가 읽은 값은 100, 별도 연결이 읽은 값은 200이었습니다. 읽는 쪽에서 `ROLLBACK`으로 기존 트랜잭션을 끝낸 후에는 200을 읽었습니다.

| 확인 항목 | 실측 결과 |
| --- | --- |
| 반환 전후 DB 세션 | 동일 |
| 재사용 연결의 조회 | 100 |
| 별도 연결의 조회 | 200 |
| 재사용 연결에서 롤백한 뒤 조회 | 200 |

앞의 실험에서는 쓰기가 미커밋 상태였고, 여기서는 쓰기가 이미 커밋됐습니다. 동일 시각에 서로 다른 값을 읽었다는 관찰만으로 둘을 구별할 수 없어요. 어떤 연결에서 트랜잭션과 첫 읽기가 시작됐고, 어느 연결에서 쓰기와 커밋이 끝났는지 연결해야 합니다. PostgreSQL의 `REPEATABLE READ`는 트랜잭션 스냅샷을 유지하고, 기본 `READ COMMITTED`는 명령마다 새 스냅샷을 얻습니다. 이 실험에서는 격리 수준을 명시적으로 바꿨습니다.

## return을 없애기보다 종료 책임을 묶었습니다

당시 원문에는 누락된 종료 처리를 보완하고, 로컬과 개발 서버에서 중간 종료 시 롤백 로그를 확인했다고 남아 있습니다. 이번 실험에서는 업무 함수가 일찍 반환하든 예외를 던지든 외부 함수가 트랜잭션을 끝내도록 경계를 묶었습니다.

```javascript
async function withTransaction(work) {
  const client = await pool.connect();
  let discard = false;
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      discard = true;
      throw new AggregateError([error, rollbackError], 'Transaction cleanup failed');
    }
    throw error;
  } finally {
    client.release(discard);
  }
}
```

같은 드라이버에서 업무 함수가 400으로 수정하고 바로 `return`하면 별도 연결에서도 400이 보였습니다. 이어서 500으로 수정한 뒤 의도적으로 예외를 던지자 별도 연결은 계속 400을 읽었습니다. 정상 반환의 커밋과 예외의 롤백을 각각 확인한 셈이에요. 모든 업무 쿼리는 전달받은 `client`를 사용했습니다.

롤백 자체가 실패하면 그 연결을 다시 빌려주지 않도록 `release(true)`로 폐기하는 경로도 코드에 넣었습니다. 다만 이 실험은 통신 단절이나 커밋 응답 유실을 주입하지 않았습니다. 그런 상황의 최종 커밋 여부나 업무 재시도까지 이 함수로 해결했다고 주장하지는 않겠습니다.

## 원문에서 잘못 설명한 부분도 고쳤어요

원문에는 `START TRANSACTION`을 다시 보내면 이전 작업이 롤백된다는 설명이 있었습니다. MariaDB와 MySQL의 공식 문서에 따르면 새 `START TRANSACTION`은 기존 트랜잭션을 **암묵적으로 커밋**합니다. 따라서 그 문장을 근거로 당시 값이 사라진 원인을 확정할 수는 없습니다. 새 트랜잭션을 시작해서 연결을 정리하겠다는 코드도 쓰면 안 됩니다. 의도하지 않은 이전 쓰기를 확정할 수 있기 때문이에요.

이번에 확인한 PostgreSQL 실험을 MariaDB의 모든 명령 동작으로 옮기지도 않습니다. 공통으로 확인하려는 것은 요청의 종료, 풀 반환, DB 트랜잭션 종료가 각각 어디에 있는가입니다. 수정값이 이상하게 보이면 조회 결과만 비교하기보다, 같은 DB 세션의 시작과 첫 읽기, 쓰기, 종료를 연결해서 보는 편이 원인을 더 정확하게 구별합니다.

## 직접 실행하려면

[전체 재현 코드](/blog/examples/database-transactions.mjs)는 임시 PostgreSQL 서버를 개인 Unix 소켓으로 시작하고, 실험 후 서버와 데이터를 정리합니다. 기존 DB에 접속하거나 TCP 포트를 열지 않습니다. Node.js 24.15.0, macOS arm64에서 실행했습니다. 코드 출력의 `pool` 항목이 이 글의 결과예요.

```bash
work="$(mktemp -d)"
npm install --prefix "$work" embedded-postgres@18.4.0-beta.17 pg@8.16.3
BLOG_DB_NODE_MODULES="$work/node_modules" node public/examples/database-transactions.mjs
```

예제 파일을 따로 받았다면 마지막 명령의 경로를 받은 파일 위치로 바꾸면 됩니다. 실행기가 요구하는 공유 메모리 사용 권한은 필요합니다. 버전과 결과를 함께 출력하므로 같은 명령을 다른 환경에서 실행할 때도 확인할 수 있습니다.

## 참고한 자료

- [MysqlQueryRunner 0.3.26](https://github.com/typeorm/typeorm/blob/0.3.26/src/driver/mysql/MysqlQueryRunner.ts) (TypeORM): 반환과 트랜잭션 종료 메서드의 분리
- [PoolConnection 3.14.5](https://github.com/sidorares/node-mysql2/blob/v3.14.5/lib/base/pool_connection.js), [Pool 3.14.5](https://github.com/sidorares/node-mysql2/blob/v3.14.5/lib/base/pool.js) (mysql2): 기본 연결 반환 경로
- [Transactions](https://node-postgres.com/features/transactions) (node-postgres): 같은 client에서 시작, 쿼리, 종료를 수행하는 방법
- [Transaction Isolation](https://www.postgresql.org/docs/18/transaction-iso.html) (PostgreSQL 18): 읽기 격리와 스냅샷의 수명
- [START TRANSACTION](https://mariadb.com/docs/server/reference/sql-statements/transactions/start-transaction) (MariaDB), [Implicit Commit](https://dev.mysql.com/doc/refman/8.0/en/implicit-commit.html) (MySQL 8.0): 새 트랜잭션 시작이 기존 트랜잭션에 미치는 영향
