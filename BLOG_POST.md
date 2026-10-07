---
title: "Run Concurrent Review App Experiments on Staging with the Experimental XP CLI Plugin"
author: Chap Ambrose
category: Engineering
tags: [CLI, Buildpacks, Review Apps, Developer Experience]
teaser: "XP is an unofficial, experimental CLI plugin and buildpack that routes your staging app's traffic to review apps, so you can test many branches at once on a single staging URL."
---

[Review Apps](https://devcenter.heroku.com/articles/github-integration-review-apps) make it easy to spin up a disposable app for every pull request. But each review app lives on its own domain and only gets the traffic you send it: a few clicks, a test suite, a curl loop. Staging is where your real integrations, webhooks, and teammates point, yet the review app never sees any of that traffic.

XP is an experiment in closing that gap. It's a Heroku CLI plugin plus a buildpack that turns an existing review app into a **review app experiment**: a branch that gets routed traffic from your staging app, on your staging app's domain.

**XP is not an officially supported Heroku feature.** A few of us at Heroku built it to explore an idea, and we're sharing it to get feedback. It comes with no SLA, no Heroku Support coverage, and no compatibility guarantees, and it may change or disappear at any time. Please report issues on [GitHub](https://github.com/heroku/xp/issues), not through Heroku Support.

## Run many branches on staging at once

Usually, staging runs one branch at a time, so teams queue up, take turns, or overwrite each other's deploys. XP removes that bottleneck. Every review app experiment gets its own routing rule, such as a header or query parameter, so many branches can share a single staging URL.

This matters most for agent teams. When several coding agents work in parallel, each on its own branch, they can't all deploy to staging. With XP, each agent gets its own review app experiment and its own routing key, much as [git worktrees](https://git-scm.com/docs/git-worktree) give each agent its own checkout of the same repo:

```
# Agent A's branch, reached with a header
$ heroku xp:create -a my-app-staging -b agent-a-search \
    --header x-xp=agent-a --mirror false

# Agent B's branch, reached with a query parameter
$ heroku xp:create -a my-app-staging -b agent-b-billing \
    --query xp=agent-b --mirror false
```

Every request without a routing key is served by staging as usual. Each agent adds its own key to reach its branch:

```
# Served by agent-a-search
$ curl -H "x-xp: agent-a" https://my-app-staging.herokuapp.com/search

# Served by agent-b-billing
$ curl "https://my-app-staging.herokuapp.com/billing?xp=agent-b"
```

## Expose an existing review app to staging traffic

XP sits on top of the review apps you already have. Run `xp:create` against your staging app with a branch name, and XP looks up that branch's review app in your pipeline. If the branch doesn't have one yet, XP creates it.

```
# Install the XP plugin
$ heroku plugins:install https://github.com/heroku/xp

# Turn the branch's review app into a review app experiment
$ heroku xp:create --app my-app-staging --branch new-checkout
```

Under the hood, XP adds its buildpack to the staging app. The buildpack runs a lightweight reverse proxy in each staging web dyno that sends each request to staging or to a review app experiment, based on rules stored in a single `HEROKU_XP` config var. Your review app keeps its own URL and [automatic deploys](https://devcenter.heroku.com/articles/github-integration#automatic-deploys), so every push to the branch updates the experiment.

## Mirror first, then serve

If you don't pass any routing flags, XP proposes cautious defaults and asks you to confirm them: 10% of `GET` requests in **mirror mode**. Mirrored requests go to both apps, but staging's response is the one returned, so a broken branch never interrupts anyone using staging. Pass `--mirror false` when you want the review app experiment's responses returned to clients, as in the agent examples above.

```
# Send 25% of staging traffic to the branch and return its responses
$ heroku xp:update -a my-app-staging -b new-checkout --weight 25 --mirror false
```

## Compare every branch side by side

`heroku xp:watch` shows a live table that puts each review app experiment beside the staging baseline and refreshes every few seconds:

```
$ heroku xp:watch --app my-app-staging

Active      Branch           Route                 Avg ms  Error %  Req/s
- baseline  main                                   212     0.4%     38.1
✓ live      agent-a-search   header:x-xp: agent-a  187     0.3%     1.2
✓ live      agent-b-billing  ?xp: agent-b          240     2.1%     0.8
✓ mirror    new-checkout     10%                   198     0.2%     3.9
```

When a branch is done, `xp:stop` pauses its routing and `xp:destroy` removes its rule. The review app itself stays under your pipeline's control. Run `heroku help xp` to see every command.

## Know the tradeoffs

Because XP is experimental, keep these in mind:

- **It sits in your staging request path.** The proxy handles every staging web request, so a proxy bug or a mistaken rule affects everyone using staging.
- **Review app experiments share staging's backing services.** When XP adopts an existing review app, it copies staging's config vars into it, so the branch reads from and writes to staging's database and add-ons. Mirror mode doesn't prevent side effects: a mirrored `POST` still writes.
- **Rules are basic for now.** Rules match `GET` requests, and each rule uses a single header or query parameter.
- **Nothing is guaranteed.** Commands, flags, and the `HEROKU_XP` format can change without notice, and XP may never become a product.

## Tell us what you think

If your team, or your agents, are tired of waiting their turn on staging, give XP a try. Share what worked, what broke, and what you'd want from a feature like this at [github.com/heroku/xp](https://github.com/heroku/xp).
