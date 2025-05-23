const db = require("../models");
const Order = db.Order;
const OrderItem = db.OrderItem;
const Product = db.Product;
const Customer = db.Customer;
const { Op } = require("sequelize");
const { stringify } = require('csv-stringify/sync'); // For CSV export

// Retrieve all Orders from the database (with filtering and includes)
exports.findAll = async (req, res) => {
    const { groupOrderId, paymentStatus, customerName } = req.query;
    let orderCondition = {};
    let customerCondition = {};

    if (groupOrderId) {
        orderCondition.group_order_id = groupOrderId;
    }
    if (paymentStatus) {
        orderCondition.payment_status = paymentStatus;
    }
    if (customerName) {
        // Add condition to filter by customer name (case-insensitive)
        customerCondition.name = { [Op.like]: `%${customerName}%` };
    }

    try {
        const data = await Order.findAll({
            where: orderCondition,
            include: [
                {
                    model: Customer,
                    as: 'customer',
                    where: customerCondition, // Apply customer filter here
                    attributes: ['id', 'name', 'email'] // Select needed customer fields
                },
                {
                    model: OrderItem,
                    as: 'orderItems',
                    attributes: ['quantity', 'price_at_order_time'],
                    include: [{
                        model: Product,
                        as: 'product',
                        attributes: ['id', 'name', 'weight_oz'] // Include product name and weight
                    }]
                }
            ],
            order: [['order_date', 'DESC']] // Order by date, newest first
        });
        res.send(data);
    } catch (err) {
        res.status(500).send({
            message: err.message || "Some error occurred while retrieving orders."
        });
    }
};

// Find a single Order with an id
exports.findOne = async (req, res) => {
    const id = req.params.id;

    try {
        const data = await Order.findByPk(id, {
            include: [
                {
                    model: Customer,
                    as: 'customer' // Include all customer details
                },
                {
                    model: OrderItem,
                    as: 'orderItems',
                    include: [{
                        model: Product,
                        as: 'product' // Include all product details
                    }]
                }
            ]
        });
        if (data) {
            res.send(data);
        } else {
            res.status(404).send({ message: `Cannot find Order with id=${id}.` });
        }
    } catch (err) {
        res.status(500).send({ message: "Error retrieving Order with id=" + id });
    }
};

// Update Shipping Prep details for an Order
exports.updateShippingPrep = async (req, res) => {
    const id = req.params.id;

    // Validate request body contains necessary fields
    const { package_type, package_length, package_width, package_height, total_weight_oz } = req.body;
    if (!package_type) { // Basic validation, add more as needed
        return res.status(400).send({ message: "Package type is required." });
    }

    const updateData = {
        package_type,
        package_length: package_length || null, // Allow nulls if not provided
        package_width: package_width || null,
        package_height: package_height || null,
        total_weight_oz: total_weight_oz || null,
        shipping_status: 'Processing' // Optionally update status when prepping
    };

    try {
        const [num] = await Order.update(updateData, { where: { id: id } });

        if (num == 1) {
            res.send({ message: "Order shipping details updated successfully." });
        } else {
            res.status(404).send({ message: `Cannot update Order with id=${id}. Maybe Order was not found.` });
        }
    } catch (err) {
        res.status(500).send({ message: "Error updating Order shipping details for id=" + id + ": " + err.message });
    }
};

// Update Payment Status for an Order
exports.updatePaymentStatus = async (req, res) => {
    const id = req.params.id;
    const { payment_status } = req.body;

    // Validate the incoming status
    const allowedStatuses = ['Invoice Sent', 'Payment Claimed', 'Paid', 'Error', 'Cancelled'];
    if (!payment_status || !allowedStatuses.includes(payment_status)) {
        return res.status(400).send({ message: `Invalid payment status provided. Must be one of: ${allowedStatuses.join(', ')}` });
    }

    try {
        const [num] = await Order.update({ payment_status: payment_status }, { where: { id: id } });

        if (num == 1) {
            res.send({ message: `Order payment status updated successfully to ${payment_status}.` });
        } else {
            res.status(404).send({ message: `Cannot update Order with id=${id}. Maybe Order was not found.` });
        }
    } catch (err) {
        res.status(500).send({ message: "Error updating Order payment status for id=" + id + ": " + err.message });
    }
};


// Export Orders as CSV for Pirate Ship
exports.exportCsv = async (req, res) => {
    // Use packageCategory from query
    const { groupOrderId, packageCategory } = req.query;

    if (!groupOrderId || !packageCategory) {
        return res.status(400).send({ message: "groupOrderId and packageCategory query parameters are required." });
    }

    // Define package types based on category
    let packageTypesToInclude = [];
    if (packageCategory === 'polymailer') {
        packageTypesToInclude = ['Poly Small', 'Poly Medium', 'Poly Large'];
    } else if (packageCategory === 'box') {
        packageTypesToInclude = ['Box 6x6x6', 'Box Custom'];
    } else {
        return res.status(400).send({ message: "Invalid packageCategory. Use 'polymailer' or 'box'." });
    }

    let orderCondition = {
        group_order_id: groupOrderId,
        package_type: { [Op.in]: packageTypesToInclude }, // Use Op.in for multiple types
        payment_status: { [Op.in]: ['Paid', 'Payment Claimed'] } // Export Paid or Claimed orders
    };

    try {
        const orders = await Order.findAll({
            where: orderCondition,
            include: [ { model: Customer, as: 'customer', required: true } ],
            order: [['order_date', 'ASC']]
        });

        if (!orders || orders.length === 0) {
            return res.status(404).send({ message: `No orders found for Group Order ${groupOrderId} with package category '${packageCategory}' and relevant payment status.` });
        }

        const columns = [
            "Name", "Street Address", "City", "State", "Zip", "Email",
            "Ounces", "Height", "Length", "Width"
        ];

        const data = orders.map(order => {
            let height = order.package_height;
            let length = order.package_length;
            let width = order.package_width;

            // Set default dimensions only if specific type matches, otherwise use stored/null
            if (order.package_type === 'Poly Small') { length = 9; width = 6; height = null; }
            else if (order.package_type === 'Poly Medium') { length = 11; width = 8.5; height = null; }
            else if (order.package_type === 'Poly Large') { length = 15; width = 10.5; height = null; }
            else if (order.package_type === 'Box 6x6x6') { length = 6; width = 6; height = 6; }

            return {
                "Name": order.customer.name || '', // Ensure defaults for CSV
                "Street Address": order.customer.street_address || '',
                "City": order.customer.city || '',
                "State": order.customer.state || '',
                "Zip": order.customer.zip || '',
                "Email": order.customer.email || '',
                "Ounces": order.total_weight_oz || 0, // Default weight if not set
                "Height": height, // Will be null for poly
                "Length": length,
                "Width": width
            };
        });

        const csvString = stringify(data, { header: true, columns: columns });

        // Generate a more descriptive filename
        const filename = `pirateship_export_${packageCategory}_GO${groupOrderId}_${new Date().toISOString().split('T')[0]}.csv`;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`); // Ensure filename is quoted
        res.status(200).send(csvString);

    } catch (err) {
        res.status(500).send({
            message: err.message || "Some error occurred while exporting orders."
        });
    }
};
