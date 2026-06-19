const express = require('express');
const app = express();
const port = process.env.PORT || 5000;

// App identification from environment
const appName = process.env.APP_NAME || 'unknown';
const appVersion = process.env.APP_VERSION || 'unknown';
const dyno = process.env.DYNO || 'local';
const herokuAppName = process.env.HEROKU_APP_NAME || 'unknown';

// Experiment metadata (if this is an experiment app)
const experimentName = process.env.HEROKU_EXPERIMENT_NAME;
const experimentParent = process.env.HEROKU_EXPERIMENT_PARENT;
const experimentCreated = process.env.HEROKU_EXPERIMENT_CREATED;

// Middleware for JSON body parsing
app.use(express.json());

// Middleware for request logging
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${req.method} ${req.path} - App: ${appName}`);
  next();
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    app: appName,
    version: appVersion,
    dyno,
    timestamp: new Date().toISOString()
  });
});

// Root endpoint - shows which app is responding
app.get('/', (req, res) => {
  const response = {
    message: `Hello from ${appName}!`,
    app: {
      name: appName,
      version: appVersion,
      herokuAppName,
      dyno
    },
    request: {
      method: req.method,
      path: req.path,
      headers: sanitizeHeaders(req.headers),
      query: req.query
    },
    timestamp: new Date().toISOString()
  };

  // Add experiment metadata if present
  if (experimentName) {
    response.experiment = {
      name: experimentName,
      parent: experimentParent,
      created: experimentCreated
    };
  }

  res.json(response);
});

// API endpoint for testing path-based routing
app.get('/api/*', (req, res) => {
  res.json({
    message: 'API endpoint',
    app: appName,
    version: appVersion,
    path: req.path,
    params: req.params,
    timestamp: new Date().toISOString()
  });
});

// Experiment endpoint for testing path-based routing
app.all('/experiment*', (req, res) => {
  res.json({
    message: 'Experiment endpoint',
    app: appName,
    version: appVersion,
    path: req.path,
    method: req.method,
    isExperiment: !!experimentName,
    timestamp: new Date().toISOString()
  });
});

// Echo endpoint - returns request details (useful for testing)
app.all('/echo', (req, res) => {
  res.json({
    message: 'Request echo',
    app: appName,
    version: appVersion,
    request: {
      method: req.method,
      path: req.path,
      headers: sanitizeHeaders(req.headers),
      query: req.query,
      body: req.body
    },
    timestamp: new Date().toISOString()
  });
});

// User endpoint for testing JSON body routing
app.post('/users', (req, res) => {
  const user = req.body;

  res.json({
    message: 'User endpoint',
    app: appName,
    version: appVersion,
    user: {
      type: user?.type,
      beta: user?.beta,
      tier: user?.tier
    },
    timestamp: new Date().toISOString()
  });
});

// Product endpoint for testing JSON body routing
app.post('/products', (req, res) => {
  const product = req.body;

  res.json({
    message: 'Product endpoint',
    app: appName,
    version: appVersion,
    product: {
      category: product?.category,
      price: product?.price
    },
    timestamp: new Date().toISOString()
  });
});

// Slow endpoint for testing performance
app.get('/slow', async (req, res) => {
  const delay = parseInt(req.query.delay) || 1000;

  await new Promise(resolve => setTimeout(resolve, delay));

  res.json({
    message: 'Slow endpoint',
    app: appName,
    version: appVersion,
    delay: `${delay}ms`,
    timestamp: new Date().toISOString()
  });
});

// Error endpoint for testing error handling
app.get('/error', (req, res) => {
  res.status(500).json({
    error: 'Simulated error',
    app: appName,
    version: appVersion,
    timestamp: new Date().toISOString()
  });
});

// Load test endpoint - generates some CPU/memory load
app.get('/load', (req, res) => {
  const iterations = parseInt(req.query.iterations) || 100000;
  let sum = 0;

  for (let i = 0; i < iterations; i++) {
    sum += Math.sqrt(i);
  }

  res.json({
    message: 'Load test endpoint',
    app: appName,
    version: appVersion,
    iterations,
    result: sum,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    app: appName,
    version: appVersion,
    path: req.path,
    timestamp: new Date().toISOString()
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(`Error: ${err.message}`);
  res.status(500).json({
    error: 'Internal server error',
    app: appName,
    version: appVersion,
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log('=====================================');
  console.log(`App: ${appName}`);
  console.log(`Version: ${appVersion}`);
  console.log(`Heroku App: ${herokuAppName}`);
  console.log(`Dyno: ${dyno}`);
  if (experimentName) {
    console.log(`Experiment: ${experimentName}`);
    console.log(`Parent: ${experimentParent}`);
  }
  console.log(`Port: ${port}`);
  console.log(`Server started at: ${new Date().toISOString()}`);
  console.log('=====================================');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});

// Helper function to sanitize headers (remove sensitive info)
function sanitizeHeaders(headers) {
  const sanitized = { ...headers };

  // Remove sensitive headers
  delete sanitized.authorization;
  delete sanitized.cookie;
  delete sanitized['x-auth-token'];

  return sanitized;
}
