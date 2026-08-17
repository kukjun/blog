---
title: "Scaling a stateful service: when the state can't move, route to it"
description: "A scraping service held live login sessions in memory. It worked beautifully on one server, then we scaled out and it broke. The story of a dead end (centralizing the browser) and the fix: externalize not the session, but its location."
pubDate: 2025-08-20
lang: en
tags: ["distributed systems", "scaling", "architecture", "AWS"]
translationKey: "session-aware-routing"
draft: false
---

The scraping service had to log into sites and then keep working as that logged-in user.
A single job was a sequence of requests sharing one authenticated browser session.

1. Request 1, log in to the target site.
2. Request 2, scrape the dashboard on that logged-in session.
3. Request 3, pull more detail on the same session.

On one server this was effortless. The browser session lived in memory, and every
request found it. Then traffic grew, we put the service behind a load balancer, added a
second server, and it broke right away. Request 2 landed on a machine that had never
logged in, so the session simply wasn't there.

That's the moment the textbook advice, "just make your servers stateless," stopped being
useful. My state was a live browser holding a login I couldn't cheaply serialize and
hand to another machine. The real requirement was uncomfortable but clear: a given
user's requests must always reach the same server. That's the definition of a stateful
service, and it's exactly what statelessness advice assumes away.

## The dead end I walked into first

My first instinct was to copy the database pattern. If every server can reach one shared
database, why not one shared browser? Put Playwright behind its own server, let any
scraper connect to it, and the session-sharing problem disappears.

It half-worked, and the half that failed taught me the most.

Splitting Playwright into its own tier did help. It saved network resources and cleaned
up the architecture. But it did not let two servers share a session, because Playwright
only gives you two ways in, and neither does what I wanted.

- WebSocket spins up its own independent browser per connection, so there's no sharing.
- CDP (Chrome DevTools Protocol) lets you attach to a specific browser by port, but at
  hundreds of live browsers, managing those ports becomes its own distributed systems
  problem. I'd just moved the mess, not removed it.

So I abandoned the shared-browser idea and kept the architectural split. A dead end that
eliminates an option is still progress. It told me the session was inherently pinned to
a server, and I should stop fighting that.

## The fix: externalize the location, not the session

If you can't move the session, route to it. Let each server own its own browser
sessions, keep a central map of which server holds which session, and have a router read
that map and forward each request to the right place.

```mermaid
flowchart TD
  C["client, request carries a session id"] --> ALB["ALB"]
  ALB --> R["Lambda router"]
  R <-->|"look up session, find server"| K["ElastiCache (Redis)<br/>session-to-server map, with TTL"]
  R -->|"route to the owner"| S1["EC2 scraper A<br/>owns sessions 1, 3"]
  R -.->|"or"| S2["EC2 scraper B<br/>owns sessions 2, 4"]
```
<span class="figcap">Session 1 was born on scraper A, so every follow-up request for session 1 gets routed back to A, where its browser actually lives.</span>

Three principles held the design together. First, I externalized the location, not the
session: the map lives in Redis, while the heavy, un-serializable browser state stays
exactly where it is. Second, I routed on identity: the first request creates the mapping
(with a TTL), and every later request carries the session id, so the router looks up its
owner before forwarding. Third, I planned for failure: a server dying means its sessions
are gone, so the system detects that and fails cleanly instead of routing into a void.

## Say the trade-offs out loud

Every clever routing design buys a new failure surface. Here's the honest ledger.

| New risk it introduces | How I mitigated it |
|---|---|
| Redis is now a single point of failure | Multi-AZ ElastiCache |
| A server dies and its sessions are lost | Client-side retry that starts a fresh session |
| The Lambda routing hop adds cold-start latency | Provisioned concurrency |

None of these are free. The design is only worth it because the alternative, serializing
a live browser session on every hop, is worse. Writing the failure modes down next to
the diagram is how you keep an architecture honest.

## The pattern generalizes

This was never really about scraping. The same shape shows up whenever state is
expensive to move. In WebSocket fan-out (chat, game servers) the connection lives on one
node; in chunked file uploads the in-progress upload lives where it started; in
state-machine workflows the machine's memory is pinned to a worker.

The reusable idea is to define the state's lifecycle, externalize its location, and make
routing follow it. Sticky sessions is the well-known cousin, and this is the same
instinct for when the stickiness can't be delegated to the load balancer alone.

Looking back, three things stuck with me. "Make it stateless" is a goal, not a law, so
it's better to name the genuinely sticky state and design for it than to pretend it
isn't there. You externalize the cheap thing, a pointer, not the expensive thing, the
session. And a design's real cost is its new failure modes; I met all three of mine
eventually, and the only reason they never became incidents is that they were on the
diagram from day one.

## References

- AWS, [Application Load Balancer: sticky sessions](https://docs.aws.amazon.com/elasticloadbalancing/latest/application/sticky-sessions.html)
- AWS, [Amazon ElastiCache for Redis](https://docs.aws.amazon.com/AmazonElastiCache/latest/red-ug/WhatIs.html)
- M. Kleppmann, [Designing Data-Intensive Applications](https://dataintensive.net/) (Ch. 6, partitioning and request routing)
- Playwright, [Browser & CDP connection model](https://playwright.dev/docs/api/class-browsertype)
