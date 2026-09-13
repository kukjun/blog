# /// script
# requires-python = ">=3.11"
# dependencies = ["langgraph==1.0.10"]
# ///
"""A synthetic example for the blog; no LLM, credentials, or network calls.

Run with: uv run public/examples/langgraph-supersteps.py
Dependency installation needs a network connection on the first run.
"""

import operator
from collections import Counter
from typing import Annotated, TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.errors import InvalidUpdateError
from langgraph.graph import END, START, StateGraph


class ConflictingState(TypedDict):
    value: str


conflict = StateGraph(ConflictingState)
conflict.add_node("left", lambda state: {"value": "left"})
conflict.add_node("right", lambda state: {"value": "right"})
for name in ("left", "right"):
    conflict.add_edge(START, name)
    conflict.add_edge(name, END)

try:
    conflict.compile().invoke({"value": "initial"})
except InvalidUpdateError:
    print("Without a reducer: InvalidUpdateError")
else:
    raise AssertionError("Concurrent writes unexpectedly succeeded")


class State(TypedDict):
    values: Annotated[list[str], operator.add]


calls = Counter()
side_effects = []


def left(state):
    calls["left"] += 1
    side_effects.append("left")
    return {"values": ["left"]}


def right(state):
    calls["right"] += 1
    side_effects.append("right")
    if calls["right"] == 1:
        raise RuntimeError("deliberate first-attempt failure")
    return {"values": ["right"]}


builder = StateGraph(State)
builder.add_node("left", left)
builder.add_node("right", right)
for name in ("left", "right"):
    builder.add_edge(START, name)
    builder.add_edge(name, END)

graph = builder.compile(checkpointer=InMemorySaver())
config = {"configurable": {"thread_id": "synthetic-example"}}
try:
    graph.invoke({"values": []}, config)
except RuntimeError as error:
    assert str(error) == "deliberate first-attempt failure"
else:
    raise AssertionError("Expected the injected failure")

assert calls == {"left": 1, "right": 1}
assert Counter(side_effects) == {"left": 1, "right": 1}
print("After failure: left=1, right=1; side effects remain")

result = graph.invoke(None, config)
assert sorted(result["values"]) == ["left", "right"]
assert calls == {"left": 1, "right": 2}
assert Counter(side_effects) == {"left": 1, "right": 2}
assert list(graph.get_state_history(config))
print("After resume: left=1, right=2; values=['left', 'right']")
print("PASS: conflict detection, pending writes, resume, external effects")
