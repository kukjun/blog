# /// script
# requires-python = ">=3.11,<3.12"
# dependencies = [
#   "langgraph==1.0.10",
#   "langgraph-checkpoint==4.2.0",
#   "langchain-core==1.6.3",
# ]
# ///
"""블로그용 독립 실험. LLM, 자격증명, 외부 API를 사용하지 않습니다.

실행: uv run --no-project langgraph-supersteps.py
최초 실행에는 Python과 의존성 다운로드가 필요할 수 있습니다.
"""

import operator
import platform
from collections import Counter
from importlib.metadata import version
from typing import Annotated, TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.errors import InvalidUpdateError
from langgraph.graph import END, START, StateGraph


class ConflictingState(TypedDict):
    value: str


def check_conflict():
    builder = StateGraph(ConflictingState)
    builder.add_node("left", lambda state: {"value": "left"})
    builder.add_node("right", lambda state: {"value": "right"})
    for name in ("left", "right"):
        builder.add_edge(START, name)
        builder.add_edge(name, END)
    try:
        builder.compile().invoke({"value": "initial"})
    except InvalidUpdateError:
        print("CONFLICT: InvalidUpdateError")
    else:
        raise AssertionError("동일 키의 병렬 갱신이 예상과 달리 성공했습니다")


class State(TypedDict):
    values: Annotated[list[str], operator.add]


def make_graph():
    # 두 실험은 서로 다른 그래프, 저장소, 카운터를 사용합니다.
    calls = Counter()
    effects = []

    def left(state):
        calls["left"] += 1
        effects.append("left")
        return {"values": ["left"]}

    def right(state):
        calls["right"] += 1
        effects.append("right")
        if calls["right"] == 1:
            raise RuntimeError("deliberate first-attempt failure")
        return {"values": ["right"]}

    builder = StateGraph(State)
    builder.add_node("left", left)
    builder.add_node("right", right)
    for name in ("left", "right"):
        builder.add_edge(START, name)
        builder.add_edge(name, END)
    return builder.compile(checkpointer=InMemorySaver()), calls, effects


def fail_once(graph, config, calls, effects):
    try:
        graph.invoke({"values": []}, config)
    except RuntimeError as error:
        assert str(error) == "deliberate first-attempt failure"
    else:
        raise AssertionError("의도한 첫 시도의 실패가 발생하지 않았습니다")
    assert calls == {"left": 1, "right": 1}
    assert Counter(effects) == {"left": 1, "right": 1}


def main():
    print(f"Python: {platform.python_version()}")
    for package in ("langgraph", "langgraph-checkpoint", "langchain-core"):
        print(f"{package}: {version(package)}")
    check_conflict()

    graph, calls, effects = make_graph()
    config = {"configurable": {"thread_id": "resume-example"}}
    fail_once(graph, config, calls, effects)

    live = graph.get_state(config)
    checkpoint = graph.get_state(live.config)
    tasks = {task.name: task for task in live.tasks}
    assert live.values == {"values": ["left"]}
    assert live.next == ("right",)
    assert checkpoint.values == {"values": []}
    assert set(checkpoint.next) == {"left", "right"}
    assert tasks["left"].result == {"values": ["left"]}
    assert tasks["left"].error is None
    assert tasks["right"].result is None
    assert "deliberate first-attempt failure" in tasks["right"].error
    print(f"FAILED live: values={live.values['values']}, next={list(live.next)}")
    print(f"FAILED checkpoint: values={checkpoint.values['values']}, next={sorted(checkpoint.next)}")
    print(f"FAILED tasks: left.result={tasks['left'].result}, right.error={tasks['right'].error}")

    resumed = graph.invoke(None, config)
    assert sorted(resumed["values"]) == ["left", "right"]
    assert calls == {"left": 1, "right": 2}
    assert Counter(effects) == {"left": 1, "right": 2}
    assert graph.get_state(config).next == ()
    print(f"RESUME: calls={dict(sorted(calls.items()))}, values={sorted(resumed['values'])}, effects={dict(sorted(Counter(effects).items()))}")

    # 재개가 끝난 그래프에 입력을 추가하지 않고, 같은 첫 실패부터 비교합니다.
    fresh_graph, fresh_calls, fresh_effects = make_graph()
    fresh_config = {"configurable": {"thread_id": "new-input-example"}}
    fail_once(fresh_graph, fresh_config, fresh_calls, fresh_effects)
    restarted = fresh_graph.invoke({"values": []}, fresh_config)
    assert sorted(restarted["values"]) == ["left", "right"]
    assert fresh_calls == {"left": 2, "right": 2}
    assert Counter(fresh_effects) == {"left": 2, "right": 2}
    assert fresh_graph.get_state(fresh_config).next == ()
    print(f"NEW_INPUT: calls={dict(sorted(fresh_calls.items()))}, values={sorted(restarted['values'])}, effects={dict(sorted(Counter(fresh_effects).items()))}")
    print("PASS: conflict, state views, resume, new input, effects")


if __name__ == "__main__":
    main()
