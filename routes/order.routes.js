const orders = require("../controllers/order.controller.js");
const authJwt = require("../middleware/authJwt");
const express = require("express");
const router = express.Router();

// Apply JWT verification middleware to all order routes
router.use(authJwt.verifyToken);

// Retrieve all Orders (with filtering options)
router.get("/", orders.findAll);

// Export Orders as CSV
router.get("/export/csv", orders.exportCsv); // Keep GET for simplicity, could be POST

// Retrieve a single Order with id
router.get("/:id", orders.findOne);

// Update Shipping Prep details for an Order with id
router.put("/:id/shipping-prep", orders.updateShippingPrep);

// Update Payment Status (e.g., Mark as Paid)
router.put("/:id/payment-status", orders.updatePaymentStatus); // Added this route

// Note: Order creation happens via the webhook/bot logic, not typically via direct API call by admin
// Note: Order deletion might be restricted or handled differently (e.g., cancellation status)

module.exports = router;
