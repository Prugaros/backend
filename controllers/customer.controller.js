'use strict';

const db = require("../models");
const Customer = db.Customer;
const { Op } = require("sequelize");

exports.getDestashList = async (req, res) => {
    try {
        const customers = await Customer.findAll({
            where: {
                wants_destash_notification: true
            },
            attributes: ['name', 'email']
        });
        res.status(200).send(customers);
    } catch (error) {
        console.error("Error fetching destash list:", error);
        res.status(500).send({ message: "Error fetching destash list." });
    }
};

exports.unsubscribeGroupOrder = async (req, res) => {
    try {
        const [updated] = await Customer.update(
            { disable_grouporder_notification: true },
            { where: { facebook_psid: req.params.psid } }
        );
        res.status(200).send(`
            <html>
                <body style="font-family: Arial, sans-serif; padding: 40px; text-align: center; background-color: #0f0f0f; color: #e5e7eb;">
                    <div style="max-width: 600px; margin: 0 auto; background-color: #1a1a1a; padding: 40px; border-radius: 12px;">
                        <h2 style="color: #c084fc;">Unsubscribed Successfully</h2>
                        <p style="color: #9ca3af;">You have been unsubscribed from group order notifications.</p>
                        <p style="color: #6b7280; font-size: 14px; margin-top: 30px;">If this was a mistake, you can re-enable notifications from the Messenger bot menu.</p>
                    </div>
                </body>
            </html>
        `);
    } catch (error) {
        console.error("Error unsubscribing customer:", error);
        res.status(500).send("Error processing unsubscribe request.");
    }
};

exports.getCustomerStatus = async (req, res) => {
    try {
        const customer = await Customer.findOne({
            where: { facebook_psid: req.params.psid },
            attributes: ['wants_destash_notification']
        });
        if (customer) {
            res.status(200).send(customer);
        } else {
            res.status(404).send({ message: "Customer not found." });
        }
    } catch (error) {
        console.error("Error fetching customer status:", error);
        res.status(500).send({ message: "Error fetching customer status." });
    }
};

exports.updateDestashNotification = async (req, res) => {
    try {
        const [updated] = await Customer.update(
            { wants_destash_notification: true },
            { where: { facebook_psid: req.params.psid } }
        );
        if (updated) {
            res.status(200).send({ message: "Successfully signed up for destash notifications." });
        } else {
            res.status(404).send({ message: "Customer not found." });
        }
    } catch (error) {
        console.error("Error updating destash notification:", error);
        res.status(500).send({ message: "Error updating destash notification." });
    }
};
