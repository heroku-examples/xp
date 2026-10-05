---
title: "Test a Branch Against Real Production Traffic with the Experimental XP CLI Plugin"
author: Chap Ambrose
category: Engineering
tags: [CLI, Buildpacks, Developer Experience]
teaser: "XP is an unofficial, experimental CLI plugin and buildpack that sends a slice of production traffic, or a mirrored copy of it, to a branch running alongside your app."
---

Staging tells you whether your code works. It doesn't tell you how that code behaves under real production traffic: unusual requests, uneven load, and the long tail of clients that only ever show up in production. Too often, the first real test happens right after you ship to everyone.

XP is an experiment in closing that gap. It's a Heroku CLI plugin plus a buildpack. Together they run a Git branch as its own app next to production, send it a controlled slice of production traffic (or a mirrored copy), and compare the two live in your terminal.

**XP is not an officially supported Heroku feature.** A few of us at Heroku built it to explore an idea, and we're sharing it to get feedback. It comes with no SLA, no Heroku Support coverage, and no compatibility guarantees, and it may change or disappear at any time. Please report issues on [GitHub](https://github.com/chap/xp/issues), not through Heroku Support.

## How XP routes traffic

XP has two parts:

- **The XP buildpack** runs a lightweight reverse proxy in front of your app inside each production web dyno. Based on your rules, it sends each request to your app, to an experiment app, or to both. It also records metrics for every route.
- **The `xp` CLI plugin** creates the experiment apps and manages the routing rules. The rules live as JSON in a single config var, `HEROKU_XP`, on your production app.

When you create an experiment, the plugin adds the buildpack to your app if it isn't already there. It then creates an app for your branch with the same buildpacks and config vars, adds that app to your pipeline, and turns on [automatic deploys](https://devcenter.heroku.com/articles/github-integration#automatic-deploys) for the branch. If your pipeline already has a [Review App](https://devcenter.heroku.com/articles/github-integration-review-apps) for the branch, XP reuses it.

## Create your first experiment

You'll need an app that's [connected to GitHub](https://devcenter.heroku.com/articles/github-integration). Install the plugin, then point it at a branch:

```
# Install the XP plugin
$ heroku plugins:install https://github.com/chap/xp

# Create an experiment for a branch
$ heroku xp:create --app my-app --branch new-checkout
```

If you don't pass any routing flags, XP proposes cautious defaults and asks you to confirm them: `GET` requests only, 10% of traffic, and mirror mode on.

## Start in mirror mode, then go live

In **mirror mode**, which is the default, XP sends matching requests to both apps but always returns production's response. Your branch handles real traffic, and users never see its failures or slowdowns.

When the numbers look good, switch to **live mode** so the branch's responses actually reach users:

```
# Serve real responses from the experiment
$ heroku xp:update --app my-app --branch new-checkout --mirror false
```

You can also target traffic by weight, path, query parameter, or header:

```
# Send 25% of traffic to the branch
$ heroku xp:update -a my-app -b new-checkout --weight 25

# Send everything under /checkout
$ heroku xp:update -a my-app -b new-checkout --path /checkout

# Opt in with a header, handy for internal testing
$ heroku xp:update -a my-app -b new-checkout --header x-xp=new-checkout
```

## Watch your branch next to production

`heroku xp:watch` shows a live table that puts each experiment beside your production baseline and refreshes every few seconds:

```
$ heroku xp:watch --app my-app

Active      Branch        Route    Avg ms  Error %  Req/s  2xx   5xx
- baseline  main                   212     0.4%     38.1   9120  37
✓ mirror    new-checkout  10% GET  187     0.3%     3.9    934   3
```

Latency, error rate, throughput, and status codes appear side by side, so you can see at a glance whether the branch is better, worse, or the same. When you're done, `xp:stop` pauses routing to an experiment, and `xp:destroy` removes the experiment and deletes its app. Run `heroku help xp` to see every command.

## Know the tradeoffs

Because XP is experimental, read these before you use it on an app that matters:

- **It sits in your request path.** The proxy handles every production web request. A proxy bug or a mistaken rule can affect real traffic, so try XP on a low-risk app first.
- **Experiment apps share production config.** They copy your config vars, including credentials and database URLs. Mirror mode doesn't prevent side effects: a mirrored `POST` still writes to your real database.
- **Experiment apps cost money.** Each one runs its own dynos and is billed like any other app.
- **Nothing is guaranteed.** Commands, flags, and the `HEROKU_XP` format can change without notice, and XP may never become a product.

## Tell us what you think

If you've wanted to try a branch on real traffic before you merge it, give XP a spin on a non-critical app. Then share what worked, what broke, and what you'd want from a feature like this at [github.com/chap/xp](https://github.com/chap/xp).
