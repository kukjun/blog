---
title: "State가 '어디선가' 업데이트되는 LangGraph의 비밀 — 알고 보니 Pregel이었다"
description: "LangGraph로 첫 에이전트를 만들며 3일을 삽질했다. State가 어디서 업데이트되는지, 체크포인트가 언제 저장되는지 디버거로 따라가도 마법 같았다. 범인은 Google이 2010년에 만든 Pregel이었다 — 그걸 알고 나니 모든 게 설명됐다."
pubDate: 2025-11-28
lang: ko
tags: ["에이전트", "LangGraph", "분산 시스템", "아키텍처"]
translationKey: "langgraph-pregel"
draft: false
---

LangGraph로 첫 에이전트를 만들 때, 머릿속이 물음표 투성이였다.

```python
from langgraph.graph import StateGraph, START, END

graph = StateGraph(State)
graph.add_node("research", research_node)
graph.add_node("analyze", analyze_node)
graph.add_edge(START, "research")
graph.add_edge("research", "analyze")

app = graph.compile(checkpointer=checkpointer)
result = app.invoke({"messages": ["Hello"]})
```

코드는 간단해 보인다. 노드 몇 개 만들고, 엣지로 연결하고, `compile()`하고 `invoke()`.
그런데 막상 돌리면 — State가 대체 어떻게 움직이는 건지, 체크포인트는 언제 저장되는지,
Super-step이 뭔지 하나도 이해가 안 됐다.

`research_node`에서 `return {"messages": [new_msg]}` 하나 했을 뿐인데 다음 노드에
전달된다. 함수를 직접 호출한 것도 아닌데, 어떻게? 공식 문서엔 "각 노드는 State를 받아
업데이트를 반환합니다"라고만 적혀 있다. 그래서 *뭐 어쩌라고?*

**3일을 삽질했다.** 디버거를 붙여 step-by-step으로 따라가도, State가 "어디선가"
업데이트되고 체크포인트가 "어디선가" 저장됐다. 말 그대로 마법 같았다.

그러다 문서를 뒤지다 한 줄을 만났다.

> "LangGraph's underlying Pregel-inspired architecture…"

**Pregel?** 처음 보는 단어였다. 찾아보니 Google이 2010년에 발표한 대규모 그래프 처리
시스템이었다. 그리고 그 순간, LangGraph의 모든 "이상한" 동작이 전부 여기서 왔다는 걸
깨달았다.

## 자전거인 줄 알았는데 F1 레이싱카였다

LangGraph는 `A → B → C` 흐름을 만드는 워크플로우 라이브러리처럼 보인다. 그런데 내부는
**분산 시스템용 그래프 처리 엔진**이다.

```text
원한 것: 자전거          (간단한 워크플로우)
받은 것: F1 레이싱카      (분산 그래프 엔진)
```

자전거 타려던 사람한테 F1을 주면서 "간단해요, 액셀만 밟으면 돼요"라고 하면 당연히
혼란스럽다. 내가 딱 그 꼴이었다. 그런데 반전이 있다 — F1을 이해하고 나면, 자전거로는
절대 못 하는 걸 하게 된다. 중단/재개, Human-in-the-Loop, 병렬 실행, 트랜잭션 보장.
이게 전부 Pregel 덕분이다.

## 도대체 Pregel이 뭐길래

2010년 Google에는 문제가 있었다. PageRank를 수십억 개 웹페이지에 돌려야 하는데
MapReduce로는 너무 느렸다. MapReduce로 짜면 매 반복마다 이렇다.

```python
for iteration in range(max_iterations):
    mapped = map_phase(graph)
    shuffled = shuffle(mapped)   # 네트워크로 데이터 전송
    graph = reduce_phase(shuffled)
    save_to_disk(graph)          # 디스크 I/O
```

반복마다 디스크 I/O에 네트워크 셔플까지. 죽을 맛이다. 그래서 Pregel을 만들었고, 핵심
아이디어는 **"Think Like a Vertex"** — 각 정점이 오직 자기 관점에서만 생각한다.

```python
class Vertex:
    def compute(self, messages):
        process(messages)                     # 받은 메시지 처리
        for neighbor in self.out_edges:
            self.send_message(neighbor, data)  # 이웃에게 전송
        if done():
            self.vote_to_halt()               # 할 일 없으면 종료
```

정점은 전체 그래프가 어떻게 생겼는지 모른다. 자기 이웃만 안다. 그게 전부다. 메시지를
주고받으며 그래프를 순회하고, 그 사이 디스크 I/O를 최소화한다.

## LangGraph는 Pregel을 어떻게 가져왔나

Pregel의 개념을 그대로 들고 와서 도메인만 바꿨다. **그래프 알고리즘 → 워크플로우
오케스트레이션.**

| Pregel | LangGraph |
|---|---|
| Vertex | Node |
| Edge | Channel |
| Message | State Update |
| Combiner | Reducer |
| `vote_to_halt()` | `END` 노드 |

Pregel의 PageRank 정점과 LangGraph 노드를 나란히 놓으면 차이가 보인다.

```python
# Pregel — 명시적으로 send_message
class PageRankVertex(Vertex):
    def compute(self, messages):
        self.value = 0.15 + 0.85 * sum(messages)
        for neighbor in self.out_edges:
            self.send_message(neighbor, self.value / len(self.out_edges))
        if converged():
            self.vote_to_halt()

# LangGraph — 그냥 dict를 return
def research_node(state: State) -> dict:
    result = search_web(state["messages"][-1])
    return {"messages": [result], "research_data": result}
```

Pregel은 `send_message()`로 명시적으로 보내는데, LangGraph는 그냥 dict를 반환한다.
**그럼 이 dict는 어떻게 다음 노드로 가는 걸까?** 여기가 내가 3일을 막혔던 지점이다.

## 드디어 풀린 State 전달의 비밀

Pregel에서 정점 A가 B에게 메시지를 보내면, (1) 메시지는 큐에 저장되고 (2) *다음*
Super-step에서 B가 큐에서 읽는다. LangGraph도 똑같다.

```python
# Super-step 1: research_node 실행
def research_node(state):
    return {"research_data": "result"}   # Channel 업데이트일 뿐

# ── Barrier Sync: 모든 노드 완료 대기 → Reducer 적용 → Checkpoint 저장 ──

# Super-step 2: analyze_node 실행
def analyze_node(state):
    data = state["research_data"]        # 이미 반영돼 있음
```

노드는 State를 직접 넘기지 않는다. **Channel을 업데이트**하면, 배리어에서 정리된 뒤
다음 Super-step에 반영된다. 이게 메시지 패싱이다. 그래서 `return`만 했는데 알아서
전달되는 것처럼 보였던 거다.

```mermaid
flowchart LR
  subgraph s1["Super-step N"]
    A1["research_node"] --> CH["Channel 업데이트"]
    B1["fact_check_node"] --> CH
  end
  CH --> BAR["Barrier Sync<br/>Reducer 병합 · Checkpoint 저장"]
  BAR --> s2["Super-step N+1<br/>analyze_node가 갱신된 State를 읽음"]
```
<span class="figcap">노드는 라운드 안에서 독립적으로 돌고, 배리어에서 병합·저장된 뒤에야 다음 라운드로 넘어간다. 이 배리어가 전체 트릭이다.</span>

## 체크포인트는 언제 저장되나

Pregel은 매 Super-step 종료 후 체크포인트를 저장한다. LangGraph도 같다 — 노드 실행
*중*에는 저장하지 않고, Super-step이 **끝나야** 저장한다. 트랜잭션 보장 때문이다.
Super-step 안에서 하나라도 실패하면 그 라운드 전체가 롤백된다.

```python
config = {"configurable": {"thread_id": "user_123"}}
app.invoke({"messages": ["Hello"]}, config)   # 중간에 실패했다고 하자
# 다시 실행하면 마지막 Checkpoint부터 자동 재개
app.invoke({"messages": ["Hello"]}, config)
```

중단/재개가 되는 게 마법이 아니라, 배리어마다 일관된 스냅샷을 찍어두기 때문이다.
Human-in-the-Loop("승인 전까지 멈춤")도 결국 *다음 Super-step을 시작하지 않는 것*일
뿐이다. State는 이미 안전하게 체크포인트돼 있으니까.

## 병렬과 Reducer

같은 Super-step 안의 노드는 서로 독립적이라 병렬 실행된다. 그런데 병렬 노드가 같은
Channel을 건드리면 충돌한다.

```python
def node_a(state): return {"messages": ["A"]}
def node_b(state): return {"messages": ["B"]}
# Reducer 없으면 하나가 덮어씀 → Reducer 있으면 병합됨
```

Reducer가 Pregel의 Combiner다. 채팅 메시지처럼 쌓여야 하는 데이터엔 이렇게 건다.

```python
from typing import Annotated
from langgraph.graph.message import add_messages

class State(TypedDict):
    messages: Annotated[list, add_messages]   # ["A"] + ["B"] → ["A","B"]
```

## 그제야 보인 설계 철학

3일 삽질의 물음표들이 하나씩 풀렸다.

- **왜 State를 인자로 받고 dict를 반환할까** → Vertex-Centric. 노드는 전체 흐름을 몰라도
  자기 일만 하면 된다. 그래서 단위 테스트가 쉽고 재사용된다.
- **왜 `compile()`이 필요할까** → 개발자 친화 API(StateGraph)를 실제 Pregel 런타임으로
  변환하는 단계다. compile 없이는 Super-step도, 체크포인트도, 트랜잭션도 없다.
- **왜 checkpointer를 주입할까** → 런타임과 지속성을 분리했기 때문. 테스트엔
  `MemorySaver`, 프로덕션엔 `PostgresSaver` — 런타임 코드는 그대로.

## 결론

LangGraph는 복잡하다. 하지만 이유가 있다. Google이 10년 넘게 검증한 Pregel을 기반으로
했기 때문이다. 처음엔 "왜 이렇게 복잡해?" 싶었는데, 알고 보니 그 복잡성이 곧 중단/재개,
Human-in-the-Loop, 병렬 실행, 트랜잭션 보장을 공짜로 주고 있었다.

자전거인 줄 알았는데 F1이었다. 그리고 F1을 이해하고 나니, 자전거로는 못 하는 걸 하게
됐다. **LangGraph의 복잡성은 버그가 아니라 기능이다** — 프레임워크가 마법처럼 느껴질
땐, 십중팔구 아직 이름 붙이지 못한 잘 알려진 시스템이 밑에 있다. 나에겐 그게 Pregel
이었다.

## 실전 팁

디버깅할 땐 Super-step 단위로 생각하면 편하다.

```python
import logging
logging.basicConfig(level=logging.DEBUG)
app.invoke({"messages": ["Hello"]})
# [Super-step 0] START
# [Super-step 1] research_node, fact_check_node  → Checkpoint saved
# [Super-step 2] analyze_node                     → Checkpoint saved
```

체크포인트 목록으로 각 스텝의 State 스냅샷도 들여다볼 수 있다.

```python
for cp in checkpointer.list(config):
    print(f"Step {cp.id}: {cp.state}")
```

---

## 참고자료 & 더 읽을거리

- Malewicz 외 — **Pregel: A System for Large-Scale Graph Processing**, Google, SIGMOD 2010. [논문](https://research.google/pubs/pub37252/)
- L. Valiant — **A Bridging Model for Parallel Computation**(BSP 모델), CACM 1990. [논문](https://dl.acm.org/doi/10.1145/79173.79181)
- **LangGraph** — *Low-level concepts: Pregel, super-steps, checkpointers*. [문서](https://langchain-ai.github.io/langgraph/concepts/low_level/)
- **LangGraph** — *Persistence & checkpointers (MemorySaver / PostgresSaver)*. [문서](https://langchain-ai.github.io/langgraph/concepts/persistence/)
