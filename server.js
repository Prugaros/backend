require('dotenv').config(); // Load environment variables from .env file
const express = require('express');
const cors = require('cors');
const db = require('./models'); // Import models/index.js for DB connection

const app = express();

// Middleware
const corsOptions = {
  origin: process.env.FRONTEND_URL, // Replace with your actual frontend URL
  credentials: true, // Allow cookies to be sent cross-origin
};
app.use(cors(corsOptions)); // Enable Cross-Origin Resource Sharing with options
app.use(express.json()); // Parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded request bodies

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

// Mount the auth routes
app.use('/api/auth', authRoutes);
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

const inventoryRoutes = require('./routes/inventory.routes');
app.use('/api/inventory', inventoryRoutes);

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
