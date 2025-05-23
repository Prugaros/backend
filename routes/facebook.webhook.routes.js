const webhookController = require("../controllers/facebook.webhook.controller.js");
const express = require("express");
const router = express.Router();

// Route for Facebook Webhook verification (GET request)
router.get("/", webhookController.verifyWebhook);

// Route for receiving webhook events from Facebook (POST request)
router.post("/", webhookController.handleEvent);

module.exports = router;
