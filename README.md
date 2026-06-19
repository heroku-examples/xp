I have created a comprehensive README.md for Heroku Experiments at:

/Users/cambrose/Documents/heroku-previews-plugin/EXPERIMENTS_README.md

The README includes:

1. **What is Heroku Experiments** - Clear explanation of production A/B testing and experimentation capabilities

2. **How It Differs from Review Apps** - Detailed comparison table showing that experiments are for production testing with real traffic, while review apps are for pre-production testing

3. **Architecture** - Visual diagram and explanation of the reverse proxy architecture with Traefik, showing how traffic flows from internet through Traefik on the parent dyno to either the production app (localhost:5000) or experiment apps (external)

4. **Installation** - Complete 4-step setup process including CLI plugin installation, buildpack setup, Procfile configuration, and deployment

5. **All Command Examples** - Comprehensive documentation of all 8 commands (create, list, info, update, start, stop, destroy, watch) with xp: aliases, flags, options, and real-world examples

6. **Routing Features** - Detailed sections on:
   - Weight-based routing (probabilistic load balancing)
   - Path-based routing (URL paths)
   - Query parameter routing
   - Header-based routing
   - JSON body routing with JSONPath expressions
   - Traffic mirroring (send to both apps)
   - Routing priority order

7. **HEROKU_EXPERIMENTS Format** - Complete JSON structure documentation with field descriptions

8. **How It Works with App-Setups and Dyno-Proxy** - Explained throughout the architecture section and installation steps, showing how the plugin uses Heroku's app-setups API to create experiment apps, and how the dyno-proxy buildpack installs Traefik to route traffic

9. **Workflow Examples** - 4 real-world scenarios:
   - Gradual rollout (5% → 25% → 50%)
   - Beta user testing
   - API version testing
   - Load testing with traffic mirroring

10. **Comprehensive Troubleshooting** - 6 major issue categories with symptoms, causes, and solutions:
    - Experiment not receiving traffic
    - Traefik not starting
    - 502 Bad Gateway errors
    - High latency
    - Config var size limits
    - Stats API issues

11. **Security** - Input validation, binary verification, config security, network security, permissions, and best practices

The document is production-ready, well-structured with a table of contents, includes code examples throughout, and provides clear next steps for users at every stage.
