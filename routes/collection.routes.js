const router = require("express").Router();
const collections = require("../controllers/collection.controller.js");

// Create a new Collection
router.post("/", collections.create);

// Retrieve all Collections
router.get("/", collections.findAll);

// Retrieve a single Collection with id
router.get("/:id", collections.findOne);

// Update a Collection with id
router.put("/:id", collections.update);

// Delete a Collection with id
router.delete("/:id", collections.delete);

// Save the collection order
router.post("/order", collections.saveOrder);

// Update the collection order
router.post("/update-order", collections.updateOrder);

module.exports = router;
