const db = require("../models");
const Product = db.Product;

// Upsert a Product based on product_url
exports.upsert = async (req, res) => {
  // Validate request
  if (!req.body.name || !req.body.product_url) {
    res.status(400).send({
      message: "Product name and URL cannot be empty!",
    });
    return;
  }

  const { product_url } = req.body;
  const productData = {
    name: req.body.name,
    description: req.body.description,
    price: req.body.price,
    images: req.body.images || [],
    weight_oz: req.body.weight_oz,
    is_active: req.body.is_active !== undefined ? req.body.is_active : true,
    MSRP: req.body.MSRP,
    collectionId: req.body.collectionId,
    product_url: req.body.product_url,
  };

  try {
    const [product, created] = await Product.findOrCreate({
      where: { product_url: product_url },
      defaults: productData,
    });

    if (!created) {
      // Product was found, so update it
      await product.update(productData);
      res.send({ message: "Product updated successfully.", data: product });
    } else {
      // Product was created
      res.send({ message: "Product created successfully.", data: product });
    }
  } catch (err) {
    console.error("Upsert error:", err);
    res.status(500).send({
      message:
        err.message || "Some error occurred while upserting the Product.",
    });
  }
};

// Retrieve all Product URLs from the database
exports.findAllUrls = async (req, res) => {
  try {
    const data = await Product.findAll({
      attributes: ['product_url'],
      raw: true,
    });
    const urls = data.map(product => product.product_url);
    res.send(urls);
  } catch (err) {
    res.status(500).send({
      message:
        err.message || "Some error occurred while retrieving product URLs.",
    });
  }
};

// Retrieve all Products with their URL and is_active status
exports.findAllProductsStatus = async (req, res) => {
  try {
    const data = await Product.findAll({
      attributes: ['product_url', 'is_active'],
      raw: true,
    });
    console.log("Sending product statuses:", data);
    res.send(data);
  } catch (err) {
    console.error("Error in findAllProductsStatus:", err);
    res.status(500).send({
      message:
        err.message || "Some error occurred while retrieving product statuses.",
    });
  }
};

// Update the is_active status of multiple products
exports.updateStatuses = async (req, res) => {
  const { productsToUpdate } = req.body; // Expect an array of objects with product_url and is_active

  if (!productsToUpdate || !Array.isArray(productsToUpdate)) {
    return res.status(400).send({ message: "An array of products to update is required." });
  }

  try {
    await db.sequelize.transaction(async (t) => {
      for (const product of productsToUpdate) {
        await Product.update(
          { is_active: product.is_active },
          {
            where: { product_url: product.product_url },
            transaction: t,
          }
        );
      }
    });

    res.send({ message: "Product statuses updated successfully." });
  } catch (err) {
    console.error("Error updating product statuses:", err);
    res.status(500).send({
      message:
        err.message || "Some error occurred while updating product statuses.",
    });
  }
};
