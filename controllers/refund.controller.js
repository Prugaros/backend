const db = require('../models');
const Refund = db.Refund;
const Order = db.Order;
const Product = db.Product;

// Create a new refund
exports.createRefund = async (req, res) => {
  try {
    const { order_id, product_id, quantity, price } = req.body;

    // Validate that the order and product exist
    const order = await Order.findByPk(order_id);
    const product = await Product.findByPk(product_id);

    if (!order) {
      return res.status(404).send({ message: 'Order not found.' });
    }

    if (!product) {
      return res.status(404).send({ message: 'Product not found.' });
    }

    const refund = await Refund.create({
      order_id,
      product_id,
      quantity,
      price
    });

    res.status(201).send(refund);
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
};

// Get all pending refunds
exports.getPendingRefunds = async (req, res) => {
  try {
    const refunds = await Refund.findAll({
      where: { state: 'pending' },
      include: [
        {
          model: Order,
          as: 'order',
          include: [
            {
              model: db.Customer,
              as: 'customer',
              attributes: ['id', 'name', 'email']
            }
          ]
        },
        {
          model: Product,
          as: 'product',
          attributes: ['id', 'name']
        }
      ]
    });

    const groupedRefunds = refunds.reduce((acc, refund) => {
      const customerId = refund.order.customer.id;
      if (!acc[customerId]) {
        acc[customerId] = {
          customer: refund.order.customer,
          refunds: [],
          total: 0,
          shipping_cost: refund.order.shipping_cost
        };
      }
      acc[customerId].refunds.push(refund);
      acc[customerId].total += refund.quantity * refund.price;
      return acc;
    }, {});

    res.status(200).send(Object.values(groupedRefunds));
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
};

// Update the state of a refund
exports.updateRefundState = async (req, res) => {
  try {
    const { id } = req.params;
    const { state } = req.body;

    const refund = await Refund.findByPk(id);

    if (!refund) {
      return res.status(404).send({ message: 'Refund not found.' });
    }

    await refund.update({ state });

    res.status(200).send(refund);
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
};
