---
title: "A personal LLM setting failed. Why did the request reach the shared backend?"
description: "I added per-user settings, but callers still fell back to a shared environment configuration. Connecting the setting to the execution path meant keeping failures inside the selected scope and making recovery work."
pubDate: 2026-09-13
lang: en
tags: ["agents", "runtime", "backend", "isolation", "error handling"]
translationKey: "per-user-llm-backend"
featuredOrder: 1
draft: false
---

I was adding per-user LLM settings to an agent product. Previously, requests went to
a shared backend configured on the server. Adding personal settings sounds like it
should let each user choose their own backend. But after changing the storage model,
I followed the callers and found that the old route was still there.

When a personal setting was missing, the caller picked up the server's shared
configuration. With one configuration, that had been a default. Once users could
pay separately, it meant something else. A request that appeared to use a personal
setting could run under a different payer.

## Missing a setting wasn't the same as choosing shared

Reduced to a small example, the problem looked like this. This is fictional code
written for the explanation, not the product's code or configuration names.

```javascript
const backend = personalSettings.get(userId) ?? sharedSettings;
```

An ordinary default for a missing value. Except that the two sides now belonged to
different payers. A user who had chosen personal mode but hadn't finished setting
it up was not in the same state as a user who had chosen shared mode.

I made the selection happen first, then resolved settings only inside that scope.
Shared mode looked up shared settings. Personal mode looked up that user's settings
and failed if they were missing or invalid. Setting management and cost attribution
also had to follow that selection.

In storage, a partial unique index allowed only one active backend per scope. That
prevented two active settings in the same scope. It couldn't stop a caller from
switching to a different scope. I had to separate what the
[partial unique index](https://www.postgresql.org/docs/current/indexes-partial.html)
enforced from what execution code needed to enforce.

## A new resolver didn't update the callers

The initial change included a function that resolved the user's selected scope.
But actual callers, including drivers and the CLI, still used the old environment
fallback. Reviewing the storage model and the new function alone would have missed it.

I followed the existing paths and connected the resolver to the callers. I also
restricted direct imports of the old function that could bypass scope validation.
Changing a function name wasn't enough. I checked how far execution actually got
when personal settings were absent.

The same failure needed different presentations at different entry points.

| Entry point | When the selected setting can't be used |
|---|---|
| CLI and driver | Reject before starting execution |
| Operations session | Show a state the user can recover from by fixing settings |
| MCP call | Return an explicit configuration failure |

The common requirement was that handling an error must not turn a personal request
into a shared request. That didn't require a CLI exit and a recovery message in an
open session to look the same.

## In a small example, there's no reason to look up another scope

Here is the core of an executable example showing that boundary. It assumes the
identity and selected mode come from an authenticated user's saved settings. The
model doesn't get to declare the user or billing scope in a tool argument.

```javascript
function resolveBackend(context, settings) {
  if (!['personal', 'shared'].includes(context.mode)) {
    throw failure('INVALID_SCOPE');
  }
  if (context.mode === 'personal' && !context.userId) {
    throw failure('MISSING_USER');
  }
  const scope = context.mode === 'personal'
    ? `personal/${context.userId}`
    : 'shared';
  const config = settings.get(scope);
  if (!config) throw failure('NOT_CONFIGURED');
  if (config.status !== 'ready') throw failure('INVALID_CONFIG');
  return { scope, backend: config.backend };
}

async function execute(context, settings, invoke) {
  const target = resolveBackend(context, settings);
  return invoke(target); // Failure stays in the selected scope.
}
```

The resolver looks up one selected key. If the subsequent call hits a rate limit,
there is no branch that looks up shared settings. The example's `status` stands in
for a validation result; it doesn't implement credential validation or billing.

You can download the [complete example and checks](/blog/examples/backend-scope.mjs)
and run `node backend-scope.mjs`. It needs no API key and makes no network requests.
It uses fictional settings in memory and simulated calls.

The checks verify that missing and invalid personal settings cause no backend call,
and that a simulated HTTP 429 calls only the selected personal backend. They also
check that two users stay separate, repairing a setting returns to the same personal
scope, and shared calls happen only after an explicit shared selection. These checks
validate the example in this article, not isolation across the entire product.

## Blocking the failure worked. Getting back to work still didn't

Testing actual user paths exposed another problem. An absent setting and an invalid
one could produce the same explanation. A user could also fix a setting and find
that their session was still stuck. Preventing a request from reaching another payer
and letting the user resume work were separate completion conditions.

I separated those states and fixed recovery after re-registering settings. I also
added a forced token refresh followed by one retry for OAuth 401 responses. That
retry stayed within the same user's selected scope; it wasn't a switch to the shared
backend.

The verification scope matters here. User-path QA ran locally on macOS with SQLite.
Configuration errors and recovery after re-registration were checked in a browser.
OAuth refresh retries were tested through dependency injection. This wasn't a check
of every success and refresh path with real subscription accounts, or of every
deployment environment including containers and PostgreSQL. The fictional example
above doesn't implement OAuth refresh either.

At first, where to store per-user settings looked like the main problem. What stayed
with me was a default left behind in a caller. Once several users started sharing
what had been a server-wide setting, code that filled in a missing value could also
change who paid for a request.

Adding the setting wasn't enough to finish the work. I had to follow what was
selected, where execution stopped on failure, and how it resumed after the user
fixed the setting.

## References

- [Partial Indexes](https://www.postgresql.org/docs/current/indexes-partial.html) (PostgreSQL): enforcing uniqueness only for rows that satisfy a condition
- [Executable fictional example](/blog/examples/backend-scope.mjs) (this article): scope selection and failure behavior, with no network requests
