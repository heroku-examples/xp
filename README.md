# Heroku XP (Experimental)

XP is an unofficial, experimental CLI plugin and buildpack that routes your staging app's traffic to review apps, so you can test many branches at once on a single staging URL.

> **XP is not an officially supported Heroku feature.** It comes with no SLA, no Heroku Support coverage, and no compatibility guarantees, and it may change or disappear at any time. Please report issues on [GitHub](https://github.com/heroku-examples/xp/issues), not through Heroku Support.

## Overview

[Review apps](https://devcenter.heroku.com/articles/github-integration-review-apps) make it easy to spin up a disposable app for every pull request, but each one lives on its own domain and only gets the traffic you send it. XP turns an existing review app into a **review app experiment**: a branch that gets routed traffic from your staging app, on your staging app's domain.

- **Run many branches on staging at once** by giving each review app experiment its own routing rule
- **Route by weight, path, query parameter, or header**
- **Mirror traffic** to a review app experiment while staging's response is still returned
- **Compare branches side by side** with real-time metrics against the staging baseline

## Installation

```bash
heroku plugins:install https://github.com/heroku-examples/xp
```

## Usage

### Create a Review App Experiment

Run `xp:create` against your staging app with a branch name. XP looks up that branch's review app in your pipeline, and creates it if it doesn't exist yet.

```bash
heroku xp:create --app my-app-staging --branch new-checkout
```

With no routing flags, XP proposes cautious defaults and asks you to confirm them: 10% of `GET` requests in mirror mode.

### Route Many Branches Through One Staging URL

Give each branch its own routing key and pass `--traffic live` so the review app's responses are returned to clients:

```bash
# Reached with a header
heroku xp:create -a my-app-staging -b agent-a-search \
  --header x-xp=agent-a --traffic live

# Reached with a query parameter
heroku xp:create -a my-app-staging -b agent-b-billing \
  --query xp=agent-b --traffic live
```

Requests without a routing key are served by staging as usual:

```bash
curl -H "x-xp: agent-a" https://my-app-staging.herokuapp.com/search
curl "https://my-app-staging.herokuapp.com/billing?xp=agent-b"
```

### Mirror First, Then Serve

Mirrored requests go to both apps, but staging's response is the one returned, so a broken branch never interrupts anyone using staging. When you're ready, return the review app's responses instead:

```bash
heroku xp:update -a my-app-staging -b new-checkout --weight 25 --traffic live
```

### Compare Branches

```bash
heroku xp:watch --app my-app-staging
```

```
Traffic   Branch           Avg ms  2xx  3xx  4xx  5xx
✓ live    main             212     97%  0%   2%   1%
✓ live    agent-a-search   187     99%  0%   1%   0%
✓ live    agent-b-billing  240     96%  0%   3%   1%
✓ mirror  new-checkout     198     98%  0%   2%   0%
```

### Clean Up

```bash
# Pause routing to the review app experiment
heroku xp:stop --app my-app-staging --branch new-checkout

# Remove its routing rule (the review app stays under your pipeline's control)
heroku xp:destroy --app my-app-staging --branch new-checkout
```

## Commands

| Command | Description |
|---------|-------------|
| `heroku xp:create` | Turn a branch's review app into a review app experiment |
| `heroku xp:list` | List review app experiments for a staging app |
| `heroku xp:update` | Update routing for a review app experiment |
| `heroku xp:start` | Resume routing to a stopped review app experiment |
| `heroku xp:stop` | Pause routing (keeps the review app running) |
| `heroku xp:destroy` | Remove a review app experiment's routing rule |
| `heroku xp:watch` | Watch traffic and metrics in real time |
| `heroku xp:config` | Show the routing configuration |

Run `heroku help xp` or `heroku xp:COMMAND --help` for details.

## How It Works

XP adds its buildpack to the staging app. The buildpack runs a lightweight reverse proxy (Traefik) in each staging web dyno that sends each request to staging or to a review app experiment, based on rules stored in a single `HEROKU_XP` config var.

```
Internet
   │
   ▼
┌──────────────────────────────────┐
│ Staging web dyno                 │
│  ┌────────────────────────────┐  │
│  │ Traefik proxy ($PORT)      │  │
│  │  • Weight                  │  │
│  │  • Path                    │  │
│  │  • Query                   │  │
│  │  • Header                  │  │
│  └─────┬───────────────┬──────┘  │
│        │               │         │
│        ▼               │         │
│   Staging app          │         │
│     :5000              │         │
└────────────────────────┼─────────┘
                         ▼
              Review app experiment
              (the branch's review app)
```

Your review app keeps its own URL and [automatic deploys](https://devcenter.heroku.com/articles/github-integration#automatic-deploys), so every push to the branch updates the experiment.

## Tradeoffs

- **XP sits in your staging request path.** The proxy handles every staging web request, so a proxy bug or a mistaken rule affects everyone using staging.
- **Review apps don't share staging's config vars or add-ons.** By default, review apps provision their own add-ons, which can cause requests to fail due to missing records or configuration. Pipelines can be configured with [sensitive config vars](https://devcenter.heroku.com/articles/github-integration-review-apps#sensitive-config-vars).
- **Nothing is guaranteed.** Commands, flags, and the `HEROKU_XP` format can change without notice, and XP may never become a product.

## Limitations

- Maximum 50 review app experiments per staging app (plugin enforced)
- 32KB config var size limit (Heroku platform limit)
- Routing changes require a restart to take effect
- Stats reset on dyno restart

## Local Testing

See [test/local/README.md](test/local/README.md) for running the proxy and routing rules locally with Docker.

## Requirements

- Heroku CLI
- Node.js >= 18.0.0 (for plugin development)
- A staging app in a pipeline with review apps enabled
- Git repository

## Security

For security vulnerabilities, email **security@heroku.com**. Do not open public GitHub issues. See [SECURITY.md](SECURITY.md).

## License

MIT License - see [LICENSE](LICENSE) file for details.
