const db = require('../models');
const Brand = db.Brand;
const { Op } = require('sequelize');

// Create and Save a new Brand
exports.create = (req, res) => {
    // Validate request
    if (!req.body.name) {
        res.status(400).send({
            message: "Content can not be empty!"
        });
        return;
    }

    // Create a Brand
    const brand = {
        name: req.body.name,
        displayOrder: req.body.displayOrder,
        isActive: req.body.isActive,
    };

    // Save Brand in the database
    Brand.create(brand)
        .then(data => {
            res.send(data);
        })
        .catch(err => {
            res.status(500).send({
                message:
                    err.message || "Some error occurred while creating the Brand."
            });
        });
};

// Retrieve all Brands from the database.
exports.findAll = (req, res) => {
    Brand.findAll({ order: [['displayOrder', 'ASC']] })
        .then(data => {
            res.send(data);
        })
        .catch(err => {
            res.status(500).send({
                message:
                    err.message || "Some error occurred while retrieving brands."
            });
        });
};

// Find a single Brand with an id
exports.findOne = (req, res) => {
    const id = req.params.id;

    Brand.findByPk(id)
        .then(data => {
            if (data) {
                res.send(data);
            } else {
                res.status(404).send({
                    message: `Cannot find Brand with id=${id}.`
                });
            }
        })
        .catch(err => {
            res.status(500).send({
                message: "Error retrieving Brand with id=" + id
            });
        });
};

// Update a Brand by the id in the request
exports.update = (req, res) => {
    const id = req.params.id;

    Brand.update(req.body, {
        where: { id: id }
    })
        .then(num => {
            if (num == 1) {
                res.send({
                    message: "Brand was updated successfully."
                });
            } else {
                res.send({
                    message: `Cannot update Brand with id=${id}. Maybe Brand was not found or req.body is empty!`
                });
            }
        })
        .catch(err => {
            res.status(500).send({
                message: "Error updating Brand with id=" + id
            });
        });
};

// Delete a Brand with the specified id in the request
exports.delete = (req, res) => {
    const id = req.params.id;

    Brand.destroy({
        where: { id: id }
    })
        .then(num => {
            if (num == 1) {
                res.send({
                    message: "Brand was deleted successfully!"
                });
            } else {
                res.send({
                    message: `Cannot delete Brand with id=${id}. Maybe Brand was not found!`
                });
            }
        })
        .catch(err => {
            res.status(500).send({
                message: "Could not delete Brand with id=" + id
            });
        });
};

// Update display order for multiple brands
exports.updateOrder = async (req, res) => {
    const { order } = req.body; // order is expected to be an array of brand IDs
    if (!order || !Array.isArray(order)) {
        return res.status(400).send({ message: "Invalid order data provided." });
    }

    try {
        const transaction = await db.sequelize.transaction();
        for (let i = 0; i < order.length; i++) {
            await Brand.update(
                { displayOrder: i },
                { where: { id: order[i] } },
                { transaction }
            );
        }
        await transaction.commit();
        res.send({ message: "Brand order updated successfully." });
    } catch (err) {
        await transaction.rollback();
        res.status(500).send({
            message: err.message || "Some error occurred while updating brand order."
        });
    }
};
