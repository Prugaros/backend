const db = require('../models');
const StoreCredit = db.StoreCredit;
const Customer = db.Customer;
const AdminUser = db.AdminUser;
const { callSendAPI } = require('../utils/facebookApi');

// Add store credit to a customer's account
exports.addStoreCredit = async (req, res) => {
  try {
    const { customer_id, amount, reason } = req.body;
    const admin_user_id = req.userId; // Assuming you have authentication middleware that adds userId to the request

    // Validate that the customer and admin user exist
    const customer = await Customer.findByPk(customer_id);
    const adminUser = await AdminUser.findByPk(admin_user_id);

    if (!customer) {
      return res.status(404).send({ message: 'Customer not found.' });
    }

    if (!adminUser) {
      return res.status(404).send({ message: 'Admin user not found.' });
    }

    const storeCredit = await StoreCredit.create({
      customer_id,
      amount,
      reason,
      admin_user_id
    });

    // Update the customer's credit balance
    const newBalance = parseFloat(customer.credit) + parseFloat(amount);
    await customer.update({ credit: newBalance });

    if (customer.facebook_psid) {
      const message = {
        text: `You have received a store credit!\n\nAmount: $${amount.toFixed(2)}\nReason: ${reason}\n\nYour new balance is $${newBalance.toFixed(2)}.`
      };
      await callSendAPI(customer.facebook_psid, message, 'POST_PURCHASE_UPDATE');
    }

    res.status(201).send(storeCredit);
    } catch (error) {
      res.status(500).send({ message: error.message });
    }
  };

// Apply credit to an order
exports.applyCreditToOrder = async (orderId, transaction) => {
    const Order = db.Order;
    const Customer = db.Customer;
    const StoreCredit = db.StoreCredit;

    const order = await Order.findByPk(orderId, { transaction });
    if (order) {
        const customer = await Customer.findByPk(order.customer_id, { transaction });
        if (customer && customer.credit > 0) {
            let totalAmount = parseFloat(order.total_amount);
            let creditToApply = Math.min(totalAmount, parseFloat(customer.credit));

            if (creditToApply > 0) {
                order.total_amount = totalAmount - creditToApply;
                order.applied_credit = creditToApply;
                await order.save({ transaction });

                customer.credit = parseFloat(customer.credit) - creditToApply;
                await customer.save({ transaction });

                await StoreCredit.create({
                    customer_id: customer.id,
                    amount: -creditToApply,
                    reason: `Applied to order #${order.id}`,
                    admin_user_id: 1 // System user
                }, { transaction });

                return {
                    appliedCredit: creditToApply,
                    newTotal: order.total_amount
                };
            }
        }
    }
    return {
        appliedCredit: 0,
        newTotal: order ? order.total_amount : 0
    };
};

// Refund credit for a cancelled order
exports.refundCreditForCancelledOrder = async (orderId, transaction) => {
    const Order = db.Order;
    const Customer = db.Customer;
    const StoreCredit = db.StoreCredit;

    const order = await Order.findByPk(orderId, { transaction });
    if (order && order.applied_credit > 0) {
        const customer = await Customer.findByPk(order.customer_id, { transaction });
        if (customer) {
            customer.credit = parseFloat(customer.credit) + parseFloat(order.applied_credit);
            await customer.save({ transaction });

            await StoreCredit.create({
                customer_id: order.customer_id,
                amount: order.applied_credit,
                reason: `Credit refunded from cancelled order #${order.id}`,
                admin_user_id: 1 // System user
            }, { transaction });
        }
    }
};

// Get store credit for a specific customer
exports.getStoreCreditByCustomer = async (req, res) => {
  try {
    const { customer_id } = req.params;

    const storeCredits = await StoreCredit.findAll({
      where: { customer_id },
      include: [
        {
          model: Customer,
          as: 'customer',
          attributes: ['id', 'name', 'email']
        },
        {
            model: AdminUser,
            as: 'adminUser',
            attributes: ['id', 'username']
        }
      ]
    });

    if (!storeCredits) {
      return res.status(404).send({ message: 'No store credit found for this customer.' });
    }

    res.status(200).send(storeCredits);
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
};

// Get all customers with their store credit balance
exports.getAllCustomersWithStoreCredit = async (req, res) => {
    try {
      const customers = await Customer.findAll();
      res.status(200).send(customers);
    } catch (error) {
      res.status(500).send({ message: error.message });
    }
  };
