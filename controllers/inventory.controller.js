const db = require('../models');
const Inventory = db.Inventory;
const Product = db.Product;
const GroupOrder = db.GroupOrder;
const Sequelize = require('sequelize');
const { Op } = require("sequelize"); // For search operators if needed

// Add stock to a product
exports.addStock = async (req, res) => {
  try {
    const productId = req.params.productId;
    const { quantity, description } = req.body;

    // Check if the product exists
    const product = await Product.findByPk(productId);
    if (!product) {
      return res.status(404).send({ message: 'Product not found.' });
    }

    // Create a new inventory history record
    await db.InventoryHistory.create({
      productId: productId,
      quantity: quantity,
      type: 'addition',
      date: new Date(),
      description: description
    });

    // Update the inventory table
    const inventory = await db.Inventory.findOne({ where: { productId: productId } });
    if (inventory) {
      await inventory.update({ quantityInStock: Sequelize.literal(`quantityInStock + ${quantity}`) });
    } else {
      await db.Inventory.create({
        productId: productId,
        quantityInStock: quantity
      });
    }

    res.send({ message: 'Stock added successfully.' });

  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Error adding stock.', error: err.message });
  }
};

// Subtract stock from a product
exports.subtractStock = async (req, res) => {
  try {
    const productId = req.params.productId;
    const { quantity, description } = req.body;

    // Check if the product exists
    const product = await Product.findByPk(productId);
    if (!product) {
      return res.status(404).send({ message: 'Product not found.' });
    }

    // Check if there is enough stock
    const inventory = await db.Inventory.findOne({ where: { productId: productId } });
    if (!inventory || inventory.quantityInStock < quantity) {
      return res.status(400).send({ message: 'Not enough stock.' });
    }

    // Create a new inventory history record
    await db.InventoryHistory.create({
      productId: productId,
      quantity: -quantity,
      type: 'sale',
      date: new Date(),
      description: description
    });

    // Update the inventory table
    await inventory.update({ quantityInStock: Sequelize.literal(`quantityInStock - ${quantity}`) });

    res.send({ message: 'Stock subtracted successfully.' });

  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Error subtracting stock.', error: err.message });
  }
};

// Adjust stock levels for a product
exports.adjustStock = async (req, res) => {
  try {
    const productId = req.params.productId;
    const { quantity, description } = req.body;

    // Check if the product exists
    const product = await Product.findByPk(productId);
    if (!product) {
      return res.status(404).send({ message: 'Product not found.' });
    }

    // Create a new inventory history record
    await db.InventoryHistory.create({
      productId: productId,
      quantity: quantity - product.quantityInStock,
      type: 'adjustment',
      date: new Date(),
      description: description
    });

    // Update the inventory table
    const inventory = await db.Inventory.findOne({ where: { productId: productId } });
    if (!inventory) {
       return res.status(404).send({ message: 'Inventory not found.' });
    }
    await inventory.update({ quantityInStock: quantity });

    res.send({ message: 'Stock adjusted successfully.' });

  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Error adjusting stock.', error: err.message });
  }
};

// Get the current stock level for a product
exports.getStockLevel = async (req, res) => {
  try {
    const productId = req.params.productId;

    const inventory = await db.Inventory.findOne({ where: { productId: productId } });

    if (!inventory) {
      return res.status(404).send({ message: 'Inventory not found for this product.' });
    }

    res.send({ quantityInStock: inventory.quantityInStock });

  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Error getting stock level.', error: err.message });
  }
};

// Get all Products with quantityInStock > 0
exports.findInStock = async (req, res) => {
  try {
    const products = await Product.findAll({
      include: [
        {
          model: db.Collection,
          as: 'collection',
          required: false,
        },
        {
          model: db.Inventory,
          as: 'inventory',
          required: true,
          where: {
            quantityInStock: {
              [Op.gt]: 0
            }
          },
          attributes: []
        }
      ],
    });

    const productIds = products.map(product => product.id);

const productsWithDetails = await Product.findAll({
      where: {
        id: {
          [Op.in]: productIds
        }
      },
      include: [
        {
          model: db.Collection,
          as: 'collection',
          required: false,
        },
        {
          model: db.Inventory,
          as: 'inventory',
          required: false,
          attributes: ['quantityInStock']
        }
      ],
    });

    const productsWithQuantity = productsWithDetails.map(product => {
      return {
        ...product.dataValues,
        quantityInStock: product.inventory ? product.inventory.quantityInStock : 0
      }
    })

    res.send(productsWithQuantity);
  } catch (err) {
    console.error(err);
    res.status(500).send({
      message:
        err.message || "Some error occurred while retrieving in stock products.",
    });
  }
};

// Get shipment intake list for a specific group order
exports.getShipmentIntakeList = async (req, res) => {
  const { groupOrderId } = req.params;

  try {
    // Verify that the group order exists
    const groupOrder = await GroupOrder.findByPk(groupOrderId);
    if (!groupOrder) {
      return res.status(404).send({ message: `Group order with id=${groupOrderId} not found.` });
    }

    // Fetch all products associated with the group order, including Brand and Collection
    const products = await Product.findAll({
      include: [
        {
          model: GroupOrder,
          as: 'groupOrders',
          where: { id: groupOrderId },
          through: { attributes: [] } // Exclude join table attributes
        },
        {
          model: db.Brand,
          as: 'brand',
          attributes: ['name', 'DisplayOrder'], // Fetch brand name and DisplayOrder
          required: false // Don't require a brand to exist
        },
        {
          model: db.Collection,
          as: 'collection',
          attributes: ['name', 'DisplayOrder'], // Fetch collection name and DisplayOrder
          required: false // Don't require a collection to exist
        }
      ],
      order: [
        [{ model: db.Brand, as: 'brand' }, 'DisplayOrder', 'ASC'], // Sort by brand DisplayOrder
        [{ model: db.Collection, as: 'collection' }, 'DisplayOrder', 'ASC'], // Sort collections by DisplayOrder
        ['collectionProductOrder', 'ASC'], // Sort products by collectionProductOrder
        ['name', 'ASC'] // Fallback sort by product name
      ]
    });

    const shipmentIntakeList = await Promise.all(products.map(async product => {
      try {
        const quantity = await db.OrderItem.sum('quantity', {
          where: { product_id: product.id },
          include: [{
            model: db.Order,
            as: 'order',
            where: {
              group_order_id: groupOrderId,
              payment_status: 'Paid'
            }
          }]
        }) || 0;

        const shipmentIntakeItem = await db.ShipmentIntakeItem.sum('received_quantity', {
          where: {
            group_order_id: groupOrderId,
            product_id: product.id
          }
        }) || 0;

        const remainingQuantity = Math.max(0, quantity - shipmentIntakeItem);
        const difference = shipmentIntakeItem - quantity;

        return {
          productId: product.id,
          name: product.name,
          quantity: remainingQuantity,
          receivedQuantity: shipmentIntakeItem,
          difference: difference,
          brand: product.brand, // Include brand data
          collection: product.collection // Include collection data
        };
      } catch (err) {
        console.error(`Error calculating quantity for product ${product.id}:`, err, 'Product data:', product.toJSON()); // Log product data
        return { productId: product.id, name: product.name, quantity: 0, receivedQuantity: 0, difference: difference, brand: null, collection: null };
      }
    }));

    res.send(shipmentIntakeList);
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Error getting shipment intake list.', error: err.message });
  }
};

// Handle shipment intake
exports.shipmentIntake = async (req, res) => {
  const { groupOrderId } = req.params;
  const receivedItems = req.body; // Array of { productId: 1, quantity: 10 }

  try {
    // Verify that the group order exists
    const groupOrder = await GroupOrder.findByPk(groupOrderId);
    if (!groupOrder) {
      return res.status(404).send({ message: `Group order with id=${groupOrderId} not found.` });
    }

    // Process each product in the shipment
    for (const item of receivedItems) {
      const { productId, quantity } = item;

      // Find the product
      const product = await Product.findByPk(productId);
      if (!product) {
        console.warn(`Product with id=${productId} not found. Skipping.`);
        continue; // Skip to the next product
      }

      // Create or update a ShipmentIntakeItem record
      await db.ShipmentIntakeItem.upsert({
        group_order_id: groupOrderId,
        product_id: productId,
        received_quantity: quantity,
      });

      // Create a new inventory history record
      await db.InventoryHistory.create({
        productId: productId,
        quantity: quantity,
        type: 'addition',
        date: new Date(),
        description: 'Shipment Intake'
      });

      // Find the inventory
      let inventory = await Inventory.findOne({ where: { productId: productId } });

      if (inventory) {
        await inventory.update({ quantityInStock: Sequelize.literal(`quantityInStock + ${quantity}`) });
      } else {
        await Inventory.create({
          productId: productId,
          quantityInStock: quantity
        });
      }
    }

    res.send({ message: 'Shipment intake processed successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: 'Error processing shipment intake.', error: err.message });
  }
};
