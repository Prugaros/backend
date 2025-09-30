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
