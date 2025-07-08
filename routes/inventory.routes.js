const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventory.controller');

// Add stock to a product
router.post('/:productId/add', inventoryController.addStock);

// Subtract stock from a product
router.post('/:productId/subtract', inventoryController.subtractStock);

// Adjust stock levels for a product
router.post('/:productId/adjust', inventoryController.adjustStock);

// Retrieve all in stock Products
router.get("/in-stock", inventoryController.findInStock);

// Get the current stock level for a product
router.get('/:productId', inventoryController.getStockLevel);

// Handle shipment intake
router.post('/:groupOrderId/shipment-intake', inventoryController.shipmentIntake);

// Get shipment intake list for a specific group order
router.get('/:groupOrderId/shipment-intake', inventoryController.getShipmentIntakeList);

module.exports = router;
