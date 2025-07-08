const orders = require("../controllers/order.controller.js");
const authJwt = require("../middleware/authJwt");
const express = require("express");
const router = express.Router();

// Apply JWT verification middleware to all order routes
router.use(authJwt.verifyToken);

// Retrieve all Orders (with filtering options)
router.get("/", orders.findAll);

// Get list of group orders
router.get('/purchase-list', orders.getPurchaseList);

// Get purchase list for a specific group order
router.get('/purchase-list/:groupOrderId', orders.getPurchaseListForGroupOrder);

// Create a purchase order for a specific group order
router.post('/:groupOrderId/purchase-orders', orders.createPurchaseOrder);

// Get purchase orders for a specific group order
router.get('/:groupOrderId/purchase-orders', orders.getPurchaseOrdersForGroupOrder);

// Export Orders as CSV
router.get("/export/csv", orders.exportCsv); // Keep GET for simplicity, could be POST

// Retrieve a single Order with id
router.get("/:id", orders.findOne);

// Update Payment Status (e.g., Mark as Paid)
router.put("/:id/payment-status", orders.updatePaymentStatus); // Added this route

// Trigger payment verification
router.post("/:id/trigger-payment-verification", orders.triggerPaymentVerification);

router.put("/shipment-manifest/:group_order_id", orders.updateShippingManifest);

// Note: Order creation happens via the webhook/bot logic, not typically via direct API call by admin
// Note: Order deletion might be restricted or handled differently (e.g., cancellation status)

router.get('/shipment-manifest/:group_order_id', orders.getShipmentManifest);

module.exports = router;
