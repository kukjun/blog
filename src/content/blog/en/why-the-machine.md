---
title: "I build the machine, not just the product"
description: "Why I'm betting my career on owning a reusable agent runtime, and what I'll write about here."
pubDate: 2026-08-16
lang: en
tags: ["agents", "runtime", "career"]
translationKey: "why-the-machine"
draft: false
---

For three years I've shipped AI systems into production: serving stacks, on-prem
deployments, agent runtimes that hold up under real traffic. It was good work. But most
of it lived inside one company, in one language, and was legible to almost nobody
outside it.

This blog is my attempt to fix that, out in the open, in English and Korean.

## The bet I'm making

There's a real difference between operating a machine and owning one. An operator keeps
the system reliable. That's valuable and very employable, but it has a ceiling. Someone
who builds the engine makes the thing that stamps out products, and keeps it.

The second one is my north star: a reliable, portable agent runtime. A domain-neutral
substrate that I own, that drops onto the cloud, a laptop, or an air-gapped box, and
that you reskin for a new domain by swapping the model and rewriting one thing, the
verifier.

## The idea I keep coming back to

The hardest and most reusable part of a trustworthy agent isn't the loop that calls
tools. It's the rule that the agent which did the work doesn't get to grade its own
work. Executor is not verifier. "Done" isn't the model's word for it; a separate,
deterministic check decides. Freedom is local, since inside a step the model roams
freely, and rails are global, since to move on an artifact has to pass a schema.

That principle carries across every domain. The runtime gets reused, and the verifier
is where each vertical earns its keep.

## What you'll find here

- Runtime and reliability: hand-rolled tool-use loops, backend swapping, gates,
  watchdogs, packaging for odd deployment targets.
- Honest engineering: internal benchmarks labeled as internal, failures with the logs
  attached, and the things that didn't work.
- The build in the open: I'm making an engine I want to own, and this is the logbook.

Everything here is written on personal time, from public knowledge and my own ideas.
None of it uses anyone's proprietary code, data, or secrets.

More soon. The first real teardown is already in the oven.
