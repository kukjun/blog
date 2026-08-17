---
title: "두 사용자가 같은 자리를 예약했다, 그것도 트랜잭션 안에서 — 레이스 컨디션 이야기"
description: "예약 시스템에서 두 사람이 같은 순간에 같은 자리를 예약하는데 둘 다 성공했다 — 트랜잭션과 중복 체크가 있는데도. 트랜잭션이 왜 소용없었는지, Redis 락으로 어떻게 고쳤는지, 그리고 왜 unique 제약이 더 나은 답이었을지."
pubDate: 2024-05-25
lang: ko
tags: ["동시성", "Redis", "분산 시스템", "데이터베이스"]
translationKey: "redis-distributed-lock"
draft: false
---

두 사용자가 거의 같은 순간에 같은 자리를 예약했는데 — *둘 다* 성공 응답을 받았다.
예약 코드는 insert 전에 자리가 찼는지 체크했고, 전체가 DB 트랜잭션 안에서 돌았다.
내 첫 반응은 아마 지금 당신과 같을 거다. *트랜잭션이 잡았어야지.*

안 잡았다. 그리고 왜 안 잡았는지 정확히 이해하는 게 핵심이다 — 사람들이 처음 손대는
해법("더 큰" 트랜잭션)은 안 통하고, 통하는 해법은 초보가 보는 곳에 없기 때문이다.

## 트랜잭션이 나를 구해주지 못한 이유

예약 로직은 **check-then-act**다. *이 자리 찼나? 아니오 → 예약을 insert.* 트랜잭션으로
감싸도 여전히 레이스가 난다. 두 요청 모두 어느 쪽이 insert 하기 전에 check를 하기
때문이다.

```mermaid
sequenceDiagram
  participant A as 요청 A
  participant DB as 데이터베이스
  participant B as 요청 B
  A->>DB: SELECT — 자리 찼나? (아니오)
  B->>DB: SELECT — 자리 찼나? (아니오)
  A->>DB: INSERT 예약 ✓
  B->>DB: INSERT 예약 ✓
  Note over DB: 한 자리에 예약 두 개
```
<span class="figcap">두 읽기가 어느 쓰기보다 먼저 일어난다. 어느 트랜잭션도 상대의 미커밋 insert를 못 본다(READ COMMITTED든 REPEATABLE READ든) — 그래서 둘 다 자리가 비었다고 믿는다.</span>

내가 고쳐야 했던 멘탈 모델은 이거다. 트랜잭션은 **스냅샷의 원자성과 격리**를 준다 —
check-then-act 시퀀스 전체에 대한 **상호배제**를 주지는 *않는다.* 두 요청이 같은 임계
구역을 동시에 실행하고 있는데, 아무것도 이들을 직렬화하지 않는다. 트랜잭션은 애초에
이 문제의 도구가 아니었다.

## 해법: 분산락으로 상호배제

여러 서버에 걸치면 프로세스 내 락(언어 `mutex`, `synchronized` 블록)은 무용하다 — 두
요청이 메모리를 공유하지 않는 다른 머신에 있을 수 있다. 둘 *다* 보는 락이 필요하다.

Redis가 자연스러운 건 두 가지 이유다. 명령을 단일 스레드로 순서대로 처리하고,
`SET key value NX`가 원자적이라 정확히 한 호출자만 키를 이길 수 있다. 가장 중요한
순서: **락을 트랜잭션 *전에* 획득하고, `finally`에서 해제한다.**

```text
1. acquired = SET lock:seat:{id} <token> NX PX <ttl>   // 원자적 획득
2. 획득 실패 → 거절 (다른 요청이 이 자리를 쥠)
3. BEGIN 트랜잭션
4.   check + insert
5. COMMIT
6. finally → 토큰이 아직 일치할 때만 락 해제
```

동작하는 락과 미묘하게 고장난 락을 가르는 디테일 둘:

- **TTL은 필수다.** 소유자가 3번과 6번 사이에 죽으면, TTL이 그 자리를 영원히
  데드락시키는 대신 락을 풀어준다.
- ***자기* 락만 해제한다.** 고유 토큰을 저장하고 삭제 전에 검증하라. 안 그러면 TTL이
  이미 만료된 느린 요청이 *다른* 요청이 갓 획득한 락을 지울 수 있다.

## 정직한 한계 — 그리고 내가 실제로 고를 해법

이제 단일 Redis가 단일 장애점이다. *그걸* 고치려고 Redis를 클러스터로 묶으면, 풀려던
바로 그 문제가 되살아난다. 서로 불일치할 수 있는 노드들에 걸쳐 락을 조율하는 것. 그게
[RedLock](https://redis.io/docs/latest/develop/use/patterns/distributed-locks/)이
다루는 것이고 — 진짜로 논쟁적이다(Kleppmann의
[비판](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)은
필독). 분산 락은 처음 보이는 것만큼 간단한 적이 없다.

그래서 *바로 이 버그*엔 Redis보다 DB부터 손이 간다.

| 접근 | 언제 최선인가 |
|---|---|
| 자리에 **`UNIQUE` 제약** | 불변식이 "자리당 예약 하나"일 때 — DB가 강제하게. 가장 단순, 레이스 불가능, 운영할 게 없음. |
| `SELECT … FOR UPDATE`(행 락) | *같은 행*을 read-then-write 원자적으로 해야 할 때. |
| `SERIALIZABLE` 격리 | DB가 스스로 충돌을 감지해 한 트랜잭션을 abort하게 하고 싶을 때. |
| **Redis 분산락** | 임계 구역이 DB 너머로 걸칠 때 — 외부 API 호출, 여러 데이터 저장소. |

중복 예약엔 `(seat_id, time_slot)` unique 인덱스가 두 번째 insert를 *구조적으로*
실패시킨다 — 락도, 레이스도, 튜닝할 TTL도 없다. 임계 구역이 진짜로 한 테이블보다 클
때 분산락을 꺼내라.

## 내가 얻은 것

1. **트랜잭션은 격리하지, check-then-act를 직렬화하지 않는다.** 해법을 고르기 전에
   레이스를 명시적으로 이름 붙여라. 안 그러면 "더 큰 트랜잭션"으로 "고치고" 같은 일을
   다시 보게 된다.
2. **불변식을 데이터에 최대한 가깝게 밀어라.** DB가 강제하는 unique 제약이, 운영하고
   추론해야 하는 락보다 낫다.
3. **락을 써야 한다면 디테일을 지켜라** — 크래시를 견딜 TTL, 남의 락을 절대 안 푸는
   토큰, 그리고 클러스터 모드 합의의 진짜 비용에 대한 맑은 눈.

---

## 참고자료 & 더 읽을거리

- Redis — *Distributed Locks with Redis (Redlock)*. [문서](https://redis.io/docs/latest/develop/use/patterns/distributed-locks/)
- M. Kleppmann — *How to do distributed locking*(Redlock 비판). [글](https://martin.kleppmann.com/2016/02/08/how-to-do-distributed-locking.html)
- PostgreSQL — *Transaction Isolation*. [문서](https://www.postgresql.org/docs/current/transaction-iso.html)
- M. Kleppmann — *Designing Data-Intensive Applications*(7장, 약한 격리 & 레이스 컨디션).
