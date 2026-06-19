# Example Usage

This guide walks through a complete example of setting up preview environments for a Node.js app.

## Scenario

You have a production app `bash-web` and want to create a preview environment for branch `feature-routing` that:
- Receives 50% of traffic (canary deployment)
- Is accessible via `/app-setups` path
- Can be accessed with `?x-heroku-preview=my-branch` query parameter
- Can be accessed with `x-heroku-preview: my-branch` header
- Auto-expires after 1 hour

## Step 1: Install Plugin

```bash
heroku plugins:install @heroku-cli/plugin-previews
```

## Step 2: Add Buildpack

```bash
# Your app already has a language buildpack
heroku buildpacks --app bash-web
# === bash-web Buildpack URLs
# 1. heroku/nodejs

# Add Traefik buildpack
heroku buildpacks:add https://github.com/heroku/heroku-buildpack-traefik-preview --app bash-web

# Verify
heroku buildpacks --app bash-web
# === bash-web Buildpack URLs
# 1. heroku/nodejs
# 2. https://github.com/heroku/heroku-buildpack-traefik-preview
```

## Step 3: Create Preview Environment

```bash
heroku xp:create \
  --app bash-web \
  --branch my-branch \
  --weight 50 \
  --path /app-setups \
  --query x-heroku-preview=my-branch \
  --header x-heroku-preview=my-branch \
  --ttl 1h \
  --mirror
```

Output:
```
Creating preview for branch my-branch... 
Creating mirrored preview app... 
Waiting for app setup...
Created bash-web-my-branch-a3f2c1

Preview environment created:
  Branch: my-branch
  App: bash-web-my-branch-a3f2c1
  Weight: 50%
  Paths: ["/app-setups"]
  Query params: {"x-heroku-preview":"my-branch"}
  Headers: {"x-heroku-preview":"my-branch"}
  TTL: 1h

Next steps:
  1. Deploy to activate routing:
     git commit --allow-empty -m "Add preview" && git push heroku main
  2. Deploy preview branch:
     git push heroku 'my-branch':main --app 'bash-web-my-branch-a3f2c1'

Note: 50% of traffic will be routed to the preview app
```

## Step 4: Deploy Production App

Deploy to regenerate Traefik config:

```bash
git commit --allow-empty -m "Add preview routing"
git push heroku main
```

Build output will include:
```
-----> Installing Traefik Preview Routing
       Installing Traefik v2.11.0
       Downloading Traefik binary
       Verifying checksum
       Found preview configurations
       Generating Traefik configuration
       Generating configs for branches: my-branch
       Generated Traefik configuration
-----> Traefik Preview Routing installed
       Version: 2.11.0
       Binary: .heroku/traefik/bin/traefik
       Config: .heroku/traefik/config/
```

## Step 5: Deploy Preview Branch

```bash
git checkout my-branch
git push heroku my-branch:main --app bash-web-my-branch-a3f2c1
```

## Step 6: Test Routing

### Weight-based (50% traffic)

```bash
# Run 100 requests, ~50 should go to preview
for i in {1..100}; do
  curl -s https://bash-web.herokuapp.com/ | grep -o "version-[0-9]*"
done | sort | uniq -c

# Output:
#   48 version-prod
#   52 version-preview
```

### Path-based

```bash
curl https://bash-web.herokuapp.com/app-setups
# Routes to preview app (my-branch)

curl https://bash-web.herokuapp.com/other-path
# Routes based on weight (50/50)
```

### Query parameter

```bash
curl "https://bash-web.herokuapp.com/?x-heroku-preview=my-branch"
# Always routes to preview app

curl "https://bash-web.herokuapp.com/"
# Routes based on weight (50/50)
```

### Header-based

```bash
curl -H "x-heroku-preview: my-branch" https://bash-web.herokuapp.com/
# Always routes to preview app

curl https://bash-web.herokuapp.com/
# Routes based on weight (50/50)
```

## Step 7: Monitor

### Check Traefik Logs

```bash
heroku logs --app bash-web --tail | grep Traefik
```

Output:
```
2026-06-18T12:00:00.000Z app[web.1]: Starting Traefik preview router...
2026-06-18T12:00:02.000Z app[web.1]: Traefik started (PID: 123)
```

### Check Routing Stats

```bash
heroku logs --app bash-web --tail --source app | jq 'select(.RouterName)'
```

Output (JSON access logs):
```json
{
  "ClientAddr": "1.2.3.4:12345",
  "RouterName": "preview-my-branch",
  "ServiceName": "preview-my-branch",
  "RequestPath": "/app-setups",
  "Duration": 123456789
}
```

## Step 8: Update Routing

To change weight to 10%:

```bash
heroku xp:update \
  --app bash-web \
  --branch my-branch \
  --weight 10

# Redeploy to apply
git commit --allow-empty -m "Update preview weight"
git push heroku main
```

## Step 9: Cleanup (After 1 Hour)

The preview will auto-expire after 1 hour, but you can manually destroy it:

```bash
heroku xp:destroy \
  --app bash-web \
  --branch my-branch \
  --destroy-app

# Redeploy to remove routing
git commit --allow-empty -m "Remove preview routing"
git push heroku main
```

## Step 10: Verify Removal

```bash
# Check config var
heroku config:get HEROKU_PREVIEWS --app bash-web
# {"version":1,"previews":{}}

# Check all traffic goes to production
for i in {1..100}; do
  curl -s https://bash-web.herokuapp.com/ | grep -o "version-[0-9]*"
done | sort | uniq -c
# 100 version-prod
```

## Advanced: Multiple Preview Environments

Create multiple previews simultaneously:

```bash
# Feature A: 10% weight
heroku xp:create --app bash-web --branch feature-a --weight 10 --mirror

# Feature B: path routing
heroku xp:create --app bash-web --branch feature-b --path /feature-b --mirror

# Feature C: header routing  
heroku xp:create --app bash-web --branch feature-c --header x-preview=feature-c --mirror

# Deploy to activate all
git commit --allow-empty -m "Add multiple previews"
git push heroku main
```

Result:
- 10% of general traffic → Feature A
- `/feature-b` requests → Feature B
- `x-preview: feature-c` requests → Feature C
- Remaining 90% → Production

## Debugging

### Check Generated Traefik Config

```bash
heroku run 'cat .heroku/traefik/config/dynamic/routers.yml' --app bash-web
heroku run 'cat .heroku/traefik/config/dynamic/services.yml' --app bash-web
heroku run 'cat .heroku/traefik/config/dynamic/middlewares.yml' --app bash-web
```

### Test Traefik Locally

```bash
# Download same Traefik version
curl -L https://github.com/traefik/traefik/releases/download/v2.11.0/traefik_v2.11.0_darwin_amd64.tar.gz -o traefik.tar.gz
tar xzf traefik.tar.gz

# Copy production config
heroku run 'tar czf - .heroku/traefik/config' --app bash-web | tar xzf -

# Start Traefik locally
./traefik --configFile=.heroku/traefik/config/traefik.yml
```

## Troubleshooting

### "Preview app does not exist"

You forgot `--mirror` flag. Either:
1. Create app manually: `heroku create bash-web-my-branch-a3f2c1`
2. Re-run with `--mirror`

### "Checksum verification failed"

Network issue or GitHub releases compromised. Retry:
```bash
heroku repo:purge_cache --app bash-web
git push heroku main
```

### Preview routing not working

Most common: forgot to redeploy after creating preview.
```bash
git commit --allow-empty -m "Regenerate config"
git push heroku main
```

### 502 errors to preview app

Preview app is down or not deployed:
```bash
heroku ps --app bash-web-my-branch-a3f2c1
heroku releases --app bash-web-my-branch-a3f2c1
curl https://bash-web-my-branch-a3f2c1.herokuapp.com/
```
