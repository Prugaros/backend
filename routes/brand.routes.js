const brands = require("../controllers/brand.controller.js");
const authJwt = require("../middleware/authJwt.js");
var router = require("express").Router();

// Create a new Brand
router.post("/", [authJwt.verifyToken], brands.create);

// Retrieve all Brands
router.get("/", [authJwt.verifyToken], brands.findAll);

// Update Brand order
router.post("/update-order", [authJwt.verifyToken], brands.updateOrder);

// Retrieve a single Brand with id
router.get("/:id", [authJwt.verifyToken], brands.findOne);

// Update a Brand with id
router.put("/:id", [authJwt.verifyToken], brands.update);

// Delete a Brand with id
router.delete("/:id", [authJwt.verifyToken], brands.delete);

module.exports = router;
