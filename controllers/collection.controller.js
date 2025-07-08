const db = require("../models");
const Collection = db.Collection;

// Create and Save a new Collection
exports.create = async (req, res) => {
  // Validate request
  if (!req.body.Name) {
    res.status(400).send({
      message: "Collection Name cannot be empty!",
    });
    return;
  }

  // Create a Collection object
  const collection = {
    Name: req.body.Name,
    DisplayOrder: req.body.DisplayOrder,
    isActive: req.body.isActive !== undefined ? req.body.isActive : true, // Default to true if not provided
  };

  // Save Collection in the database
  try {
    const data = await Collection.create(collection);
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message:
        err.message || "Some error occurred while creating the Collection.",
    });
  }
};

// Retrieve all Collections from the database
exports.findAll = async (req, res) => {
  try {
    const data = await Collection.findAll({ order: [['DisplayOrder', 'ASC']] });
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message:
        err.message || "Some error occurred while retrieving collections.",
    });
  }
};

// Find a single Collection with an id
exports.findOne = async (req, res) => {
  const id = req.params.id;

  try {
    const data = await Collection.findByPk(id);
    if (data) {
      res.send(data);
    } else {
      res.status(404).send({
        message: `Cannot find Collection with id=${id}.`,
      });
    }
  } catch (err) {
    res.status(500).send({
      message: "Error retrieving Collection with id=" + id,
    });
  }
};

// Update a Collection by the id in the request
exports.update = async (req, res) => {
  const id = req.params.id;

  // Basic validation
  if (!req.body) {
    return res.status(400).send({ message: "Data to update can not be empty!" });
  }

  try {
    const num = await Collection.update(req.body, {
      where: { id: id },
    });

    if (num == 1) { // Sequelize update returns an array with one element: the number of affected rows
      res.send({
        message: "Collection was updated successfully.",
      });
    } else {
      res.status(404).send({ // Or 400 if update data was invalid for the model
        message: `Cannot update Collection with id=${id}. Maybe Collection was not found or req.body is empty!`,
      });
    }
  } catch (err) {
    res.status(500).send({
      message: "Error updating Collection with id=" + id + ": " + err.message,
    });
  }
};

// Delete a Collection with the specified id in the request
exports.delete = async (req, res) => {
  const id = req.params.id;

  try {
    // Find all products that belong to the collection
    const productsToUpdate = await db.Product.findAll({
      where: { collectionId: id }
    });

    // Set the collectionId of those products to null
    await Promise.all(productsToUpdate.map(async product => {
      product.collectionId = null;
      await product.save();
    }));

    // Delete the collection
    const num = await Collection.destroy({
      where: { id: id },
    });

    if (num == 1) {
      res.send({
        message: "Collection was deleted successfully!",
      });
    } else {
      res.status(404).send({
        message: `Cannot delete Collection with id=${id}. Maybe Collection was not found!`,
      });
    }
  } catch (err) {
    res.status(500).send({
      message: "Could not delete Collection with id=" + id + ": " + err.message,
    });
  }
};

// Save the collection order
exports.saveOrder = async (req, res) => {
  const order = req.body.order; // Array of collection IDs in the desired order

  if (!order || !Array.isArray(order)) {
    return res.status(400).send({ message: "Invalid order data." });
  }

  try {
    // Update the DisplayOrder for each collection
    for (let i = 0; i < order.length; i++) {
      const collectionId = order[i];
      await Collection.update({ DisplayOrder: i }, {
        where: { id: collectionId }
      });
    }

    res.send({ message: "Collection order saved successfully." });
  } catch (err) {
    res.status(500).send({
      message: err.message || "Error saving collection order."
    });
  }
};
