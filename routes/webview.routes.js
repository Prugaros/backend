const controller = require("../controllers/webview.controller.js");
const express = require("express");
const router = express.Router();

// Route to get data for the order webview (identified by psid)
router.get("/order-data", controller.getOrderData);

// Route for the webview to submit updated cart data
router.post("/update-cart", controller.updateCart);

// Route for the webview to finalize the order and trigger bot's next step
router.post("/finalize-order", controller.finalizeOrder);

module.exports = router;
