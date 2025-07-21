const products = require("../controllers/product.controller.js");
const authJwt = require("../middleware/authJwt"); // Import the exported object directly
const express = require("express");
const router = express.Router();

// Public routes (no authentication required for viewing products)
router.get("/", products.findAll);
router.get("/:id", products.findOne);

// Protected routes (require JWT verification for admin actions)
router.post("/", [authJwt.verifyToken], products.create);
router.put("/:id", [authJwt.verifyToken], products.update);
router.delete("/:id", [authJwt.verifyToken], products.delete);

module.exports = router;
