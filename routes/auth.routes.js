const controller = require("../controllers/auth.controller");
const express = require("express");
const router = express.Router(); // Use express.Router()

// Define auth routes
router.post("/login", controller.login);

// Optional: Add registration route if implementing signup
// router.post("/register", controller.register);

module.exports = router; // Export the router
