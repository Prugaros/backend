const groupOrders = require("../controllers/groupOrder.controller.js");
const authJwt = require("../middleware/authJwt"); // Import the exported object directly
const express = require("express");
const router = express.Router();

// Apply JWT verification middleware to all group order routes
router.use(authJwt.verifyToken);
// Optional: Add ensureUserExists if needed
// router.use(authJwt.ensureUserExists);

// --- Standard CRUD ---

// Create a new GroupOrder (optionally with product IDs)
router.post("/", groupOrders.create);

// Retrieve all GroupOrders (includes associated products)
router.get("/", groupOrders.findAll);

// Retrieve a single GroupOrder with id (includes associated products)
router.get("/:id", groupOrders.findOne);

// Update a GroupOrder with id (can update basic fields and product associations)
router.put("/:id", groupOrders.update);

// Delete a GroupOrder with id
router.delete("/:id", groupOrders.delete);


// --- Special Actions ---

// Start a Group Order (change status, TODO: FB post)
router.post("/:id/start", groupOrders.startOrder);

// End a Group Order (change status)
router.post("/:id/end", groupOrders.endOrder);

// Reactivate a Group Order (change status)
router.put("/:id/reactivate", groupOrders.reactivateOrder);


module.exports = router;
