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
    description: req.body.description,
    price: req.body.price,
    image_url: req.body.image_url, // Assuming URL is provided directly for now
    weight_oz: req.body.weight_oz,
    is_active: req.body.is_active !== undefined ? req.body.is_active : true, // Default to true if not provided
    quantityInStock: req.body.quantityInStock || 0,
  };

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
  const { searchTerm, activeOnly } = req.query;
  var condition = {};

  if (searchTerm) {
    condition[Op.or] = [
      { name: { [Op.like]: `%${searchTerm}%` } },
      { '$collection.Name$': { [Op.like]: `%${searchTerm}%` } }
    ];
  }

  if (activeOnly === 'true') {
    condition.is_active = true;
  }

  try {
    const data = await Product.findAll({
      where: condition,
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
        err.message || "Some error occurred while retrieving products.",
    });
  }
};

// Find a single Product with an id
exports.findOne = async (req, res) => {
  const id = req.params.id;

  try {
    const data = await Product.findByPk(id);
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

  try {
    const num = await Product.update(req.body, {
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

// TODO: Add image upload logic later (likely involving S3)
