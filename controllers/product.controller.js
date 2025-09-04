const db = require("../models");
const Product = db.Product;
const { Op } = require("sequelize"); // For search operators if needed

// Create and Save a new Product
exports.create = async (req, res) => {
  // Validate request
  if (!req.body.name || !req.body.price) {
    res.status(400).send({
      message: "Product name and price cannot be empty!",
    });
    return;
  }

  // Create a Product object
  const product = {
    name: req.body.name,
    product_url: req.body.product_url,
    description: req.body.description,
    price: req.body.price,
    images: req.body.images || [], // Use 'images' field
    weight_oz: req.body.weight_oz,
    is_active: req.body.is_active !== undefined ? req.body.is_active : true,
    quantityInStock: req.body.quantityInStock || 0,
    collectionId: req.body.collectionId,
  };

  // If a collectionId is provided, set collectionProductOrder to place at the top
  if (product.collectionId) {
    try {
      const maxOrderProduct = await Product.findOne({
        where: { collectionId: product.collectionId },
        order: [['collectionProductOrder', 'DESC']],
        attributes: ['collectionProductOrder'],
        raw: true,
      });
      product.collectionProductOrder = (maxOrderProduct ? maxOrderProduct.collectionProductOrder : -1) + 1;
    } catch (err) {
      console.error("Error determining collectionProductOrder:", err);
      // Fallback to default if error occurs
      product.collectionProductOrder = 0;
    }
  }

  // Save Product in the database
  try {
    const data = await Product.create(product);
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message:
        err.message || "Some error occurred while creating the Product.",
    });
  }
};

// Retrieve all Products from the database (with optional filtering/searching)
exports.findAll = async (req, res) => {
  const { searchTerm, activeOnly, is_blacklisted } = req.query;
  var condition = {};

  if (searchTerm) {
    condition[Op.or] = [
      { name: { [Op.like]: `%${searchTerm}%` } },
      { '$collection.name$': { [Op.like]: `%${searchTerm}%` } }
    ];
  }

  if (activeOnly === 'true') {
    condition.is_active = true;
  }

  // Handle the is_blacklisted filter
  if (is_blacklisted === 'true') {
    condition.is_blacklisted = true;
  } else {
    condition.is_blacklisted = false;
  }

  try {
    const data = await Product.findAll({
      where: condition,
      attributes: ['id', 'name', 'description', 'price', 'images', 'weight_oz', 'is_active', 'MSRP', 'collectionId', 'collectionProductOrder', 'is_blacklisted', 'is_featured', 'product_url'], // Explicitly include 'images' and 'collectionProductOrder'
      include: [{
        model: db.Collection,
        as: 'collection',
        required: false // Allow products without a collection to be returned
      }, {
        model: db.Brand,
        as: 'brand',
        required: false
      }],
      order: [['collectionProductOrder', 'DESC'], ['name', 'ASC']], // Order by collectionProductOrder first, then name
      raw: false // Ensure getters are applied
    });
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message:
        err.message || "Some error occurred while retrieving products.",
    });
  }
};

// Find a single Product with an id
exports.findOne = async (req, res) => {
  const id = req.params.id;

  try {
    const data = await Product.findByPk(id, {
      attributes: ['id', 'name', 'description', 'price', 'images', 'weight_oz', 'is_active', 'MSRP', 'collectionId', 'collectionProductOrder', 'product_url'],
      include: [{
        model: db.Collection,
        as: 'collection' // Use the alias defined in your model associations
      }, {
        model: db.Brand,
        as: 'brand' // Use the alias defined in your model associations
      }],
      raw: false // Getters should be applied
    });
    if (data) {
      res.send(data);
    } else {
      res.status(404).send({
        message: `Cannot find Product with id=${id}.`,
      });
    }
  } catch (err) {
    res.status(500).send({
      message: "Error retrieving Product with id=" + id,
    });
  }
};

// Update a Product by the id in the request
exports.update = async (req, res) => {
  const id = req.params.id;

  // Basic validation
  if (!req.body) {
      return res.status(400).send({ message: "Data to update can not be empty!" });
  }

  // Ensure images is handled correctly if present in req.body
  const updateData = { ...req.body };
  if (updateData.images) {
    // The setter in the model will handle JSON.stringify
    updateData.images = updateData.images;
  }

  try {
    const num = await Product.update(updateData, {
      where: { id: id },
    });

    if (num == 1) { // Sequelize update returns an array with one element: the number of affected rows
      res.send({
        message: "Product was updated successfully.",
      });
    } else {
      res.status(404).send({ // Or 400 if update data was invalid for the model
        message: `Cannot update Product with id=${id}. Maybe Product was not found or req.body is empty!`,
      });
    }
  } catch (err) {
    res.status(500).send({
      message: "Error updating Product with id=" + id + ": " + err.message,
    });
  }
};

// Delete a Product with the specified id in the request
exports.delete = async (req, res) => {
  const id = req.params.id;

  try {
    const num = await Product.destroy({
      where: { id: id },
    });

    if (num == 1) {
      res.send({
        message: "Product was deleted successfully!",
      });
    } else {
      res.status(404).send({
        message: `Cannot delete Product with id=${id}. Maybe Product was not found!`,
      });
    }
  } catch (err) {
    res.status(500).send({
      message: "Could not delete Product with id=" + id + ": " + err.message,
    });
  }
};

// Get all Products with quantityInStock > 0
exports.findInStock = async (req, res) => {
  try {
    const data = await Product.findAll({
      where: {
        quantityInStock: {
          [Op.gt]: 0
        }
      },
      include: [{
        model: db.Collection,
        as: 'collection',
        required: false // Allow products without a collection to be returned
      }],
      order: [['name', 'ASC']]
    });
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message:
        err.message || "Some error occurred while retrieving in stock products.",
    });
  }
};

// Update the order of products within a collection
exports.updateCollectionProductOrder = async (req, res) => {
  const { collectionId } = req.params;
  const { productIds } = req.body; // Expect an array of product IDs in the desired order

  if (!collectionId || !productIds || !Array.isArray(productIds)) {
    return res.status(400).send({ message: "Collection ID and an ordered list of product IDs are required." });
  }

  try {
    // Use a transaction to ensure atomicity
    await db.sequelize.transaction(async (t) => {
      for (let i = 0; i < productIds.length; i++) {
        const productId = productIds[i];
        const newOrder = productIds.length - 1 - i; // Assign order from top (highest value) to bottom (lowest value)

        await Product.update(
          { collectionProductOrder: newOrder },
          {
            where: {
              id: productId,
              collectionId: collectionId,
            },
            transaction: t,
          }
        );
      }
    });

    res.send({ message: "Product order updated successfully." });
  } catch (err) {
    console.error("Error updating collection product order:", err);
    res.status(500).send({
      message: err.message || "Some error occurred while updating product order.",
    });
  }
};

// TODO: Add image upload logic later (likely involving S3)
