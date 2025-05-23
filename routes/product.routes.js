const products = require("../controllers/product.controller.js");
const authJwt = require("../middleware/authJwt"); // Import the exported object directly
const express = require("express");
const router = express.Router();

// Apply JWT verification middleware to all product routes
// Ensures only logged-in admins can access these endpoints
router.use(authJwt.verifyToken);
// Optional: Add ensureUserExists if you want the extra DB check
// router.use(authJwt.ensureUserExists);

// Create a new Product
router.post("/", products.create);

// Retrieve all Products (with optional query params like ?name=...)
router.get("/", products.findAll);

// Retrieve a single Product with id
router.get("/:id", products.findOne);

// Update a Product with id
router.put("/:id", products.update);

// Delete a Product with id
router.delete("/:id", products.delete);

module.exports = router;
