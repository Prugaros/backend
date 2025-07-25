const controller = require("../controllers/scrape.controller.js");
const express = require("express");
const router = express.Router();

// Temporarily remove auth for debugging
router.post("/upsert", controller.upsert);
router.get("/urls", controller.findAllUrls);
router.get("/products-status", controller.findAllProductsStatus);
router.post("/update-statuses", controller.updateStatuses);


module.exports = router;
