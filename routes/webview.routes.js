const controller = require("../controllers/webview.controller.js");
const express = require("express");
const router = express.Router();

// Route to get data for the order webview (identified by psid)
router.get("/order-data", controller.getOrderData);

// Route to get only featured items
router.get("/featured-data", controller.getFeaturedData);

// Route to get data for a specific brand
router.get("/brand-data/:brandId", controller.getBrandData);

// Route for the webview to submit updated cart data
router.post("/update-cart", controller.updateCart);

// Route for the webview to finalize the order and trigger bot's next step
router.get("/address", controller.getAddress);

// Route for the webview to finalize the order and trigger bot's next step
router.post("/address", controller.saveAddress);

// Routes for updating conversation state
router.post("/submit-address", controller.submitAddress);
router.post("/payment-sent", controller.paymentSent);
router.get("/order-summary", controller.getOrderSummary);

module.exports = router;
