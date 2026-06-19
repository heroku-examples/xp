# Quick Start Guide

Get xp environments running in 5 minutes.

## Prerequisites

- Heroku CLI installed
- A deployed Heroku app
- Git repository connected to your app

## Step 1: Install (30 seconds)

```bash
# Install the CLI plugin
heroku plugins:install @heroku-cli/plugin-xp

# Add the buildpack to your app
heroku buildpacks:add https://github.com/heroku/heroku-buildpack-traefik-xp --app YOUR-APP-NAME
```

## Step 2: Create XP (1 minute)

```bash
# Create a xp environment that receives 10% of traffic
heroku xp:create \
  --app YOUR-APP-NAME \
  --branch YOUR-BRANCH-NAME \
  --weight 10 \
  --mirror

# Example:
heroku xp:create --app bash-web --branch my-feature --weight 10 --mirror
```

This will:
- ✅ Create a new Heroku app mirrored from production
- ✅ Configure routing to send 10% of traffic to the xp
- ✅ Store configuration in `HEROKU_XP` config var

## Step 3: Deploy to Activate (2 minutes)

```bash
# Deploy production app to install Traefik and generate routing config
git commit --allow-empty -m "Add Traefik xp routing"
git push heroku main

# Deploy your feature branch to the xp app
git push heroku YOUR-BRANCH-NAME:main --app YOUR-APP-NAME-xp-YOUR-BRANCH-NAME
```

## Step 4: Test (1 minute)

```bash
# Send 100 requests, ~10 should go to xp
for i in {1..100}; do curl -s https://YOUR-APP-NAME.herokuapp.com; done

# Or test with explicit routing (always goes to xp):
curl "https://YOUR-APP-NAME.herokuapp.com/?branch=YOUR-BRANCH-NAME"
```

## Done! 🎉

Your xp environment is now live and receiving traffic.

## Next Steps

### Add Path-based Routing

Route specific paths to your xp:

```bash
heroku xp:create \
  --app YOUR-APP-NAME \
  --branch YOUR-BRANCH-NAME \
  --path /xp/YOUR-BRANCH-NAME \
  --mirror

# Redeploy
git commit --allow-empty -m "Add path routing"
git push heroku main

# Test
curl https://YOUR-APP-NAME.herokuapp.com/xp/YOUR-BRANCH-NAME
```

### Add Header-based Routing

Route requests with custom headers:

```bash
heroku xp:create \
  --app YOUR-APP-NAME \
  --branch YOUR-BRANCH-NAME \
  --header x-xp=YOUR-BRANCH-NAME \
  --mirror

# Redeploy
git commit --allow-empty -m "Add header routing"
git push heroku main

# Test
curl -H "x-xp: YOUR-BRANCH-NAME" https://YOUR-APP-NAME.herokuapp.com
```

### Add Auto-expiry

XP environments that auto-delete after a time period:

```bash
heroku xp:create \
  --app YOUR-APP-NAME \
  --branch YOUR-BRANCH-NAME \
  --weight 10 \
  --ttl 2h \
  --mirror

# This xp will automatically expire after 2 hours
```

### Multiple XP Environments

Create multiple xps simultaneously:

```bash
# Feature A: 5% weight
heroku xp:create --app YOUR-APP-NAME --branch feature-a --weight 5 --mirror

# Feature B: path routing
heroku xp:create --app YOUR-APP-NAME --branch feature-b --path /feature-b --mirror

# Feature C: header routing
heroku xp:create --app YOUR-APP-NAME --branch feature-c --header x-test=feature-c --mirror

# Redeploy to activate all
git commit --allow-empty -m "Add multiple xps"
git push heroku main
```

Result:
- 5% of traffic → Feature A
- `/feature-b` requests → Feature B
- `x-test: feature-c` header → Feature C
- Remaining 95% → Production

## Common Commands

```bash
# List all xp environments
heroku xp:list --app YOUR-APP-NAME

# Update a xp's routing
heroku xp:update --app YOUR-APP-NAME --branch YOUR-BRANCH-NAME --weight 20

# Destroy a xp
heroku xp:destroy --app YOUR-APP-NAME --branch YOUR-BRANCH-NAME --destroy-app

# Check configuration
heroku config:get HEROKU_XP --app YOUR-APP-NAME | jq .

# View Traefik logs
heroku logs --app YOUR-APP-NAME --tail | grep Traefik
```

## Troubleshooting

### XP not routing

**Problem**: Created xp but traffic isn't routing

**Solution**: You forgot to redeploy after creating the xp
```bash
git commit --allow-empty -m "Regenerate Traefik config"
git push heroku main
```

### App name error

**Problem**: "XP app does not exist"

**Solution**: You forgot the `--mirror` flag, or the app name is wrong
```bash
# Option 1: Use --mirror to auto-create
heroku xp:create --app YOUR-APP --branch YOUR-BRANCH --mirror

# Option 2: Create the app manually first
heroku create YOUR-APP-xp-YOUR-BRANCH
heroku xp:create --app YOUR-APP --branch YOUR-BRANCH
```

### 502 Bad Gateway

**Problem**: XP app returns 502 errors

**Solution**: XP app is down or not deployed
```bash
# Check if xp app exists
heroku apps:info --app YOUR-APP-xp-YOUR-BRANCH

# Deploy to xp app
git push heroku YOUR-BRANCH:main --app YOUR-APP-xp-YOUR-BRANCH

# Check xp app health
curl https://YOUR-APP-xp-YOUR-BRANCH.herokuapp.com
```

## Need Help?

- 📖 Full docs: `README.md`
- 🔍 Detailed example: `EXAMPLE.md`
- 🔒 Security info: `SECURITY.md`
- 🏗️ Architecture: `PROJECT_SUMMARY.md`

## Cleanup

When you're done testing:

```bash
# Remove xp environment
heroku xp:destroy --app YOUR-APP-NAME --branch YOUR-BRANCH-NAME --destroy-app

# Redeploy to remove routing
git commit --allow-empty -m "Remove xp"
git push heroku main
```

---

**That's it!** You now have Heroku xp environments with advanced traffic routing. 🚀
