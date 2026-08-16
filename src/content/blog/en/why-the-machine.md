---
title: "I build the machine, not just the product"
description: "Why I'm betting my career on owning a reusable agent runtime — and what I'll write about here."
pubDate: 2026-08-16
lang: en
tags: ["agents", "runtime", "career"]
translationKey: "why-the-machine"
draft: false
---

For three years I've shipped AI systems: serving stacks, on-prem deployments,
agent runtimes that survive contact with production. Good work — but most of it
lived inside one company, in one language, legible to almost no one outside.

This blog is me fixing that. In public. In English and Korean.

## The bet

There's a difference between operating a machine and owning one. An operator keeps
the system reliable — valuable, employable, and capped. An **engine builder** makes
the thing that stamps out products, and keeps it.

My north star is the second one: a **reliable, portable agent runtime** — a
domain-neutral substrate I own, that I can drop onto the cloud, a laptop, or an
air-gapped box, and reskin for a new vertical by swapping the model and rewriting
one thing: the **verifier**.

## The one idea I keep coming back to

The hardest, most reusable part of a trustworthy agent isn't the loop that calls
tools. It's the rule that **the agent which did the work does not get to grade its
own work.** Executor ≠ verifier. A separate, deterministic check decides "done" —
not the model's own say-so. Freedom is local (inside a step the model roams free);
rails are global (to advance, an artifact must pass a schema).

That principle is portable across every domain. The runtime is reusable; the
verifier is where each vertical earns its keep.

## What you'll find here

- **Runtime & reliability** — hand-rolled tool-use loops, backend swapping, gates,
  watchdogs, packaging for weird deployment targets.
- **Honest engineering** — internal benchmarks labeled as internal, failures with
  the logs, things that didn't work.
- **The build in the open** — I'm making an owned engine. This is the logbook.

Everything here is written on personal time, from public knowledge and my own
ideas — never anyone's proprietary code, data, or secrets.

More soon. The first real teardown is already in the oven.
