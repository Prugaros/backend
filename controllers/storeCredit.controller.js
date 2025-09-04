const db = require('../models');
const StoreCredit = db.StoreCredit;
const Customer = db.Customer;
const AdminUser = db.AdminUser;
const { callSendAPI } = require('./facebook.webhook.controller');

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
      await callSendAPI(customer.facebook_psid, message);
    }

    res.status(201).send(storeCredit);
  } catch (error) {
    res.status(500).send({ message: error.message });
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
