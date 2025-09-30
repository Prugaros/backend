require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const cors = require('cors');
const db = require('./models'); // Import models/index.js for DB connection
const path = require('path'); // Add this line
const multer = require('multer'); // Import multer for error handling
const fs = require('fs'); // Import file system module

const app = express();

// Middleware
const corsOptions = {
  origin: process.env.FRONTEND_URL, // Replace with your actual frontend URL
  credentials: true, // Allow cookies to be sent cross-origin
};
app.use(cors(corsOptions)); // Enable Cross-Origin Resource Sharing with options

// Add a middleware to log all incoming requests
app.use((req, res, next) => {
  // console.log(`Received request: ${req.method} ${req.url}`);
  next();
});

// Import upload routes
const uploadRoutes = require('./routes/upload.routes');

// Increase the limit for JSON and URL-encoded bodies
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Mount upload routes AFTER general body parsers
app.use('/api/upload', uploadRoutes);

// Set Content-Security-Policy header
app.use((req, res, next) => {
  const backendUrl = process.env.VITE_BACKEND_URL;
  const frontendUrl = process.env.FRONTEND_URL; // Assuming FRONTEND_URL is also set in .env
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'self' ${frontendUrl} ${backendUrl} https://cdn.ngrok.com; ` +
    `img-src 'self' data: ${backendUrl} https://w3.org; ` + // Allow images from backendUrl
    `style-src 'self' 'unsafe-inline'; ` +
    `script-src 'self' 'unsafe-eval' 'unsafe-inline';`
  );
  next();
});

// Serve static files from the 'public' directory using an absolute path
app.use(express.static(path.join(__dirname, 'public')));
console.log('Serving static files from:', path.join(__dirname, 'public')); // Add this log

// Simple route for testing
app.get('/', (req, res) => {
  res.json({ message: 'Welcome to the Facebook SCG Bot Backend!' });
});

// --- API Routes ---
const authRoutes = require('./routes/auth.routes');
const productRoutes = require('./routes/product.routes');
const groupOrderRoutes = require('./routes/groupOrder.routes');
const facebookWebhookRoutes = require('./routes/facebook.webhook.routes');
const orderRoutes = require('./routes/order.routes');
const webviewRoutes = require('./routes/webview.routes'); // Require webview routes
const scrapeRoutes = require('./routes/scrape.routes');

// Mount the auth routes
app.use('/api/auth', authRoutes);
app.use('/api/scrape', scrapeRoutes);
// Mount the product routes (prefixed with /api/products)
app.use('/api/products', productRoutes);
// Mount the group order routes (prefixed with /api/group-orders)
app.use('/api/group-orders', groupOrderRoutes);
// Mount the order routes (prefixed with /api/orders)
app.use('/api/orders', orderRoutes);
// Mount the webview routes (prefixed with /api/webview)
app.use('/api/webview', webviewRoutes); // Mount webview routes

const collectionRoutes = require('./routes/collection.routes');
app.use('/api/collections', collectionRoutes);

const brandRoutes = require('./routes/brand.routes');
app.use('/api/brands', brandRoutes);

const customerRoutes = require('./routes/customer.routes');
customerRoutes(app);

const inventoryRoutes = require('./routes/inventory.routes');
app.use('/api/inventory', inventoryRoutes);

const storeCreditRoutes = require('./routes/storeCredit.routes');
storeCreditRoutes(app);

const refundRoutes = require('./routes/refund.routes');
refundRoutes(app);

// Mount the Facebook webhook routes (no auth needed for this endpoint)
app.use('/api/facebook/webhook', facebookWebhookRoutes);


// TODO: Add other API routes here (e.g., customers)

// Database Synchronization & Server Start
const PORT = process.env.PORT || 3001;

db.sequelize.sync() // Sync models with database (consider { force: true } only for dev reset)
  .then(() => {
    console.log('Database synced successfully.');

    // Verify the Product model attributes
    //console.log('Product model attributes:', db.Product.rawAttributes);

    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}.`);
    });
  })
  .catch((err) => {
    console.error('Failed to sync database:', err);
    // Consider exiting if DB connection fails critically
    // process.exit(1);
  });

// Multer error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    console.error('Multer error:', err.code, err.message);
    return res.status(400).send({ message: err.message, code: err.code });
  }
  next(err); // Pass other errors to the general error handler
});

// General error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.statusCode || 500).send({
    message: err.message || 'Something broke!',
    error: process.env.NODE_ENV === 'production' ? {} : err, // Don't expose stack in production
  });
});
