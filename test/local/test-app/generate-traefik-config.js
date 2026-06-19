#!/usr/bin/env node

/**
 * Generate Traefik dynamic configuration from HEROKU_EXPERIMENTS
 * This script simulates the behavior of the dyno-proxy buildpack
 */

const fs = require('fs');
const path = require('path');

// Configuration directory
const CONFIG_DIR = path.join(__dirname, '.heroku', 'traefik', 'config', 'dynamic');
const CONFIG_FILE = path.join(CONFIG_DIR, 'experiments.yml');

// Parse HEROKU_EXPERIMENTS from environment
const experimentsJson = process.env.HEROKU_EXPERIMENTS;

if (!experimentsJson) {
  console.log('No HEROKU_EXPERIMENTS config found, skipping Traefik config generation');
  process.exit(0);
}

let experimentsConfig;
try {
  experimentsConfig = JSON.parse(experimentsJson);
} catch (err) {
  console.error('Error parsing HEROKU_EXPERIMENTS:', err.message);
  process.exit(1);
}

// Ensure config directory exists
fs.mkdirSync(CONFIG_DIR, { recursive: true });

// Generate Traefik configuration
const traefikConfig = generateTraefikConfig(experimentsConfig);

// Write configuration file
fs.writeFileSync(CONFIG_FILE, traefikConfig, 'utf8');
console.log(`Traefik configuration written to ${CONFIG_FILE}`);

/**
 * Generate Traefik YAML configuration
 */
function generateTraefikConfig(config) {
  const lines = [];

  lines.push('# Auto-generated Traefik configuration from HEROKU_EXPERIMENTS');
  lines.push('# DO NOT EDIT - This file is regenerated on each deploy\n');

  lines.push('http:');
  lines.push('  routers:');
  lines.push('    # Default router - routes to parent app');
  lines.push('    parent-app:');
  lines.push('      rule: "PathPrefix(`/`)"');
  lines.push('      service: parent-app');
  lines.push('      priority: 1\n');

  const experiments = config.experiments || {};
  const activeExperiments = Object.values(experiments).filter(exp => exp.status === 'active');

  // Generate routers for each active experiment
  let priority = 100;
  const weightedExperiments = [];

  for (const exp of activeExperiments) {
    const routing = exp.routing || {};
    const rules = [];

    // Header-based routing (highest priority)
    if (routing.headers && Object.keys(routing.headers).length > 0) {
      for (const [key, value] of Object.entries(routing.headers)) {
        rules.push(`Header(\`${key}\`, \`${value}\`)`);
      }
    }

    // Query parameter routing
    if (routing.queries && Object.keys(routing.queries).length > 0) {
      for (const [key, value] of Object.entries(routing.queries)) {
        rules.push(`Query(\`${key}\`, \`${value}\`)`);
      }
    }

    // Path-based routing
    if (routing.paths && routing.paths.length > 0) {
      for (const pathPrefix of routing.paths) {
        rules.push(`PathPrefix(\`${pathPrefix}\`)`);
      }
    }

    // Create router if there are specific rules
    if (rules.length > 0) {
      lines.push(`    # Experiment: ${exp.name}`);
      lines.push(`    ${exp.name}:`);
      lines.push(`      rule: "${rules.join(' || ')}"`);
      lines.push(`      service: ${exp.name}`);
      lines.push(`      priority: ${priority}`);

      if (exp.mirror) {
        lines.push(`      middlewares:`);
        lines.push(`        - ${exp.name}-mirror`);
      }

      lines.push('');
      priority++;
    }

    // Track weight-based experiments for weighted service
    if (routing.weight && routing.weight > 0) {
      weightedExperiments.push({
        name: exp.name,
        appName: exp.appName,
        weight: routing.weight,
        mirror: exp.mirror
      });
    }
  }

  // If there are weighted experiments, create a weighted router
  if (weightedExperiments.length > 0) {
    lines.push('    # Weighted routing');
    lines.push('    weighted-routing:');
    lines.push('      rule: "PathPrefix(`/`)"');
    lines.push('      service: weighted-service');
    lines.push('      priority: 10\n');
  }

  // Services configuration
  lines.push('  services:');
  lines.push('    # Parent app service');
  lines.push('    parent-app:');
  lines.push('      loadBalancer:');
  lines.push('        servers:');
  lines.push('          - url: "http://localhost:5000"\n');

  // Generate services for experiments
  for (const exp of activeExperiments) {
    const appUrl = getAppUrl(exp.appName);

    lines.push(`    # Experiment: ${exp.name}`);
    lines.push(`    ${exp.name}:`);
    lines.push('      loadBalancer:');
    lines.push('        servers:');
    lines.push(`          - url: "${appUrl}"\n`);
  }

  // Weighted service configuration
  if (weightedExperiments.length > 0) {
    lines.push('    # Weighted service (combines parent + experiments)');
    lines.push('    weighted-service:');
    lines.push('      weighted:');
    lines.push('        services:');

    // Calculate parent weight (100 - sum of experiment weights)
    const totalExpWeight = weightedExperiments.reduce((sum, exp) => sum + exp.weight, 0);
    const parentWeight = 100 - totalExpWeight;

    if (parentWeight > 0) {
      lines.push('          - name: parent-app');
      lines.push(`            weight: ${parentWeight}`);
    }

    for (const exp of weightedExperiments) {
      lines.push(`          - name: ${exp.name}`);
      lines.push(`            weight: ${exp.weight}`);
    }

    lines.push('');
  }

  // Middlewares (for traffic mirroring)
  const mirrorExperiments = activeExperiments.filter(exp => exp.mirror);
  if (mirrorExperiments.length > 0) {
    lines.push('  middlewares:');

    for (const exp of mirrorExperiments) {
      const appUrl = getAppUrl(exp.appName);

      lines.push(`    ${exp.name}-mirror:`);
      lines.push('      mirror:');
      lines.push('        service:');
      lines.push(`          name: ${exp.name}`);
      lines.push(`          url: "${appUrl}"\n`);
    }
  }

  return lines.join('\n');
}

/**
 * Get app URL for an experiment
 * In Docker, use container name; in production, use Heroku URL
 */
function getAppUrl(appName) {
  // Check if running in Docker
  if (process.env.DOCKER_CONTAINER || fs.existsSync('/.dockerenv')) {
    // Use container name directly (Docker DNS)
    return `http://${appName}:5000`;
  }

  // Production: use Heroku URL
  return `https://${appName}.herokuapp.com`;
}
