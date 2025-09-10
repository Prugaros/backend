const db = require("../models");
const { Order, OrderItem, Product, Customer, GroupOrder, PurchaseOrder, PurchaseOrderItem, ShipmentManifest, Inventory } = db;
const { Op } = require("sequelize");
const { stringify } = require('csv-stringify/sync'); // For CSV export
const facebookWebhookController = require("./facebook.webhook.controller.js");
const { callSendAPI } = require("../utils/facebookApi.js");
const inventoryController = require("./inventory.controller.js");

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
                    attributes: ['id', 'name', 'email', 'facebook_psid'] // Select needed customer fields
                },
                {
                    model: OrderItem,
                    as: 'orderItems',
                    include: [{
                        model: Product,
                        as: 'orderProduct',
                        attributes: ['id', 'name', 'weight_oz'], // Include product name and weight
                        paranoid: false // Include soft-deleted products
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

exports.getShipmentManifest = async (req, res) => {
  const { group_order_id } = req.params;

  try {
    const orders = await Order.findAll({
      where: {
        group_order_id: group_order_id,
        shipping_status: 'Packed'
      },
      include: [
        {
          model: Customer,
          as: 'customer',
          attributes: ['name', 'street_address', 'city', 'state', 'zip', 'email']
        },
        {
          model: OrderItem,
          as: 'orderItems',
          include: [{
            model: Product,
            as: 'orderProduct',
          attributes: ['name'],
          paranoid: false
          }],
          attributes: ['quantity']
        }
      ]
    });

    const customerDataArray = orders.map(order => {
      const { customer, orderItems } = order;
      return {
        customerName: customer.name,
        customerAddress: customer.street_address,
        customerCity: customer.city,
        customerState: customer.state,
        customerZip: customer.zip,
        customerEmail: customer.email,
        orderItems: orderItems.map(item => ({ name: item.orderProduct.name, quantity: item.quantity }))
      };
    });

    res.send(customerDataArray);
  } catch (error) {
    console.error(error);
    res.status(500).send({
      message:
        error.message || "Some error occurred while retrieving shipment manifest."
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
                        as: 'orderProduct' // Include all product details
                    }]
                },
                {
                    model: db.Refund,
                    as: 'refunds',
                    include: [{
                        model: Product,
                        as: 'product'
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

exports.updateShippingManifest = async (req, res) => {
    const { order_ids, customer_id } = req.body; // Get the order IDs and customer_id from the request body
    const group_order_id = req.params.group_order_id; // Get the group_order_id from the URL

    // Validate request body contains necessary fields
    const { package_type, package_length, package_width, package_height, total_weight_oz } = req.body;
    if (!package_type) { // Basic validation, add more as needed
        return res.status(400).send({ message: "Package type is required." });
    }

    try {
        let shipmentManifest = await ShipmentManifest.findOne({
            where: {
                group_order_id: group_order_id,
                customer_id: customer_id
            }
        });

        if (!shipmentManifest) {
            shipmentManifest = await ShipmentManifest.create({
                group_order_id: group_order_id,
                customer_id: customer_id,
                order_ids: order_ids, // Store the order IDs in the array
                package_type: package_type,
                package_length: package_length || null,
                package_width: package_width || null,
                package_height: package_height || null,
                total_weight_oz: total_weight_oz || null
            });
        } else {
            // If shipmentManifest exists, update the order_ids array and package details
            shipmentManifest.order_ids = [...new Set([...shipmentManifest.order_ids, ...order_ids])]; // Add new order IDs and remove duplicates
            shipmentManifest.package_type = package_type;
            shipmentManifest.package_length = package_length || null;
            shipmentManifest.package_width = package_width || null;
            shipmentManifest.package_height = package_height || null;
            shipmentManifest.total_weight_oz = total_weight_oz || null;
            await shipmentManifest.save();
        }

        // Update shipping status for all orders
        await Order.update({ shipping_status: 'Packed' }, {
            where: {
                group_order_id: group_order_id,
                id: {
                  [Op.in]: order_ids
                }
            }
        });

        // Subtract stock from inventory for all orders
        for (const orderId of order_ids) {
            const orderItems = await OrderItem.findAll({
                where: { order_id: orderId }
            });

            for (const item of orderItems) {
                try {
                    await inventoryController.subtractStock(
                      {
                        params: { productId: item.product_id },
                        body: { quantity: item.quantity, description: `Order ${orderId} packing` }
                      },
                      {
                        send: (message) => {
                          console.log(message);
                        },
                        status: (statusCode) => {
                          return {
                            send: (message) => {
                              console.log(statusCode, message);
                            },
                          };
                        },
                      }
                    );
                } catch (err) {
                    console.error(`Error subtracting stock for product ${item.product_id}:`, err);
                    // Consider whether to rollback the shipping status update here
                    return res.status(500).send({ message: `Error subtracting stock for product ${item.product_id}: ${err.message}` });
                }
            }
        }

        res.send({ message: "Order shipping details updated successfully." });
    } catch (err) {
        res.status(500).send({ message: "Error updating Order shipping details: " + err.message });
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

exports.triggerPaymentVerification = async (req, res) => {
    const id = req.params.id;

    try {
        const order = await Order.findByPk(id, {
            include: [
                {
                    model: Customer,
                    as: 'customer',
                    attributes: ['id', 'name', 'email', 'facebook_psid']
                }
            ]
        });

        if (!order) {
            return res.status(404).send({ message: `Order with id=${id} not found.` });
        }

        if (!order.customer || !order.customer.facebook_psid) {
            return res.status(400).send({ message: `Customer or Facebook PSID not found for order id=${id}.` });
        }

        console.error("Calling handlePaymentVerified with:", order.customer.facebook_psid, id, order.customer);
        // Call the handlePaymentVerified function from the facebook webhook controller
        await facebookWebhookController.handlePaymentVerified(order.customer.facebook_psid, id, order.customer);
        res.send({ message: "Payment verification triggered successfully." });
    } catch (err) {
        res.status(500).send({ message: "Error triggering payment verification for order id=" + id + ": " + err.message });
    }
};

// Get list of group orders
exports.getPurchaseList = async (req, res) => {
    try {
        const groupOrders = await GroupOrder.findAll({
            attributes: ['id', 'name'], // Fetch only necessary fields
        });

        res.send(groupOrders);
    } catch (err) {
        res.status(500).send({
            message: err.message || "Some error occurred while fetching group orders."
        });
    }
};

// Get purchase list for a specific group order
exports.getPurchaseListForGroupOrder = async (req, res) => {
    const groupOrderId = req.params.groupOrderId;

    try {
        // Fetch all paid orders for the specified group order
        const orders = await Order.findAll({
            where: {
                group_order_id: groupOrderId,
                payment_status: 'Paid'
            },
            include: [
                {
                    model: OrderItem,
                    as: 'orderItems',
                    attributes: ['quantity'],
                    include: [{
                        model: Product,
                        as: 'orderProduct',
                        attributes: ['id', 'name', 'brandId', 'collectionId', 'MSRP', 'product_url'],
                        paranoid: false, // Include soft-deleted products
                        include: [
                            {
                                model: db.Brand,
                                as: 'brand',
                                attributes: ['name']
                            },
                            {
                                model: db.Collection,
                                as: 'collection',
                                attributes: ['Name', 'isDisneyStore']
                            }
                        ]
                    }]
                }
            ]
        });

        // Aggregate product quantities
        const requiredQuantities = {};
        for (const order of orders) {
            for (const item of order.orderItems) {
                const product = item.orderProduct;
                const productId = product.id;

                if (requiredQuantities[productId]) {
                    requiredQuantities[productId].quantity += item.quantity;
                } else {
                    const brandName = product.brand ? product.brand.name : 'Unknown Brand';
                    const isDisneyStore = product.collection ? product.collection.isDisneyStore : false;
                    let groupName = brandName;
                    if (brandName === 'Ohora' && isDisneyStore) {
                        groupName = 'Ohora - Disney Store';
                    }
                    requiredQuantities[productId] = {
                        name: product.name,
                        quantity: item.quantity,
                        group: groupName,
                        MSRP: product.MSRP,
                        product_url: product.product_url,
                        brandName: brandName,
                        isDisneyStore: isDisneyStore
                    };
                }
            }
        }

        // Get all purchased items for the group order
        const purchaseOrders = await PurchaseOrder.findAll({
            where: { group_order_id: groupOrderId },
            attributes: ['id']
        });
        const purchaseOrderIds = purchaseOrders.map(po => po.id);

        const purchasedQuantities = {};
        if (purchaseOrderIds.length > 0) {
            const purchaseOrderItems = await PurchaseOrderItem.findAll({
                where: {
                    purchase_order_id: { [Op.in]: purchaseOrderIds }
                }
            });
            for (const item of purchaseOrderItems) {
                if (purchasedQuantities[item.product_id]) {
                    purchasedQuantities[item.product_id] += item.quantity;
                } else {
                    purchasedQuantities[item.product_id] = item.quantity;
                }
            }
        }

        // Subtract purchased quantities from required quantities
        const purchaseList = Object.entries(requiredQuantities).map(([productId, data]) => {
            const purchased = purchasedQuantities[productId] || 0;
            return {
                productId,
                ...data,
                quantity: data.quantity - purchased
            };
        }).filter(item => item.quantity > 0);


        // Convert to array format for easier handling in frontend
        let purchaseListArray = purchaseList;

        // Sort by group name, then by product name
        purchaseListArray.sort((a, b) => {
            if (a.group < b.group) return -1;
            if (a.group > b.group) return 1;
            if (a.name < b.name) return -1;
            if (a.name > b.name) return 1;
            return 0;
        });

        res.send(purchaseListArray);
    } catch (err) {
        res.status(500).send({
            message: err.message || "Some error occurred while generating purchase list for group order."
        });
    }
};

exports.createPurchaseOrder = async (req, res) => {
    const groupOrderId = req.params.groupOrderId;
    const items = req.body.items; // Get the items from the request body

    try {
        const purchaseOrder = await PurchaseOrder.create({
            group_order_id: groupOrderId,
            // Add other fields as needed (vendor, tracking_number, etc.)
        });

        // Create the purchase order items
        if (items && items.length > 0) {
            await Promise.all(items.map(async (item) => {
                // Check if a PurchaseOrderItem already exists for this product and group order
                const existingItem = await PurchaseOrderItem.findOne({
                    where: {
                        purchase_order_id: purchaseOrder.id,
                        product_id: item.product_id
                    }
                });

                if (existingItem) {
                    // If it exists, update the quantity
                    await existingItem.update({
                        quantity: existingItem.quantity + item.quantity
                    });
                } else {
                    // If it doesn't exist, create a new PurchaseOrderItem
                    await PurchaseOrderItem.create({
                        purchase_order_id: purchaseOrder.id,
                        product_id: item.product_id,
                        quantity: item.quantity
                    });
                }
            }));
        }

        res.status(201).send(purchaseOrder);
    } catch (err) {
        res.status(500).send({
            message: err.message || "Some error occurred while creating the purchase order."
        });
    }
};

exports.getPurchaseOrdersForGroupOrder = async (req, res) => {
    const groupOrderId = req.params.groupOrderId;
    try {
        const purchaseOrders = await PurchaseOrder.findAll({
            where: { group_order_id: groupOrderId },
            include: [
                {
                    model: PurchaseOrderItem,
                    as: 'purchaseOrderItems',
                    include: [{
                        model: Product,
                        as: 'purchasedProduct',
                        include: [{
                            model: db.Brand,
                            as: 'brand',
                            attributes: ['name']
                        }]
                    }]
                }
            ]
        });
        res.send(purchaseOrders);
    } catch (err) {
        res.status(500).send({
            message: err.message || "Some error occurred while retrieving purchase orders."
        });
    }
};

exports.test = async (req, res) => {
    res.send("Order controller is working");
};

// Export Orders as CSV for Pirate Ship
exports.exportCsv = async (req, res) => {
    const { groupOrderId, packageCategory } = req.query;

    if (!groupOrderId) {
        return res.status(400).send({ message: "groupOrderId query parameter is required." });
    }

    try {
       // Fetch all shipment manifests for a given group_order_id
        let whereClause = { group_order_id: groupOrderId };
        if (packageCategory) {
            whereClause.package_type = packageCategory;
        }

        const shipmentManifests = await ShipmentManifest.findAll({
            where: whereClause,
            include: [
                {
                    model: Customer,
                    as: 'customer',
                    attributes: ['id', 'name', 'street_address', 'city', 'state', 'zip', 'email']
                },
            ],
            attributes: ['package_type', 'package_length', 'package_width', 'package_height', 'total_weight_oz']
        });

        if (!shipmentManifests || shipmentManifests.length === 0) {
            return res.status(404).send({ message: `No shipment manifests found for Group Order ${groupOrderId}.` });
        }

        // Filter for polymailers and boxes
        const polymailerData = shipmentManifests.filter(manifest => manifest.package_type === 'polymailer');
        const boxData = shipmentManifests.filter(manifest => manifest.package_type === 'box');

        // Define columns for CSV files
        const polymailerColumns = [
            "Name", "Street Address", "City", "State", "Zip", "Email",
            "Ounces", "Package", "Length", "Width"
        ];
        const boxColumns = [
            "Name", "Street Address", "City", "State", "Zip", "Email",
            "Ounces", "Package", "Length", "Width", "Height"
        ];

       // Function to map data to CSV format
        const mapToCsvData = (manifests, columns) => {
            return manifests.map(manifest => {
                console.log("manifest", manifest);
                const { customer } = manifest;
                return {
                    "Name": customer.name || '',
                    "Street Address": customer.street_address || '',
                    "City": customer.city || '',
                    "State": customer.state || '',
                    "Zip": customer.zip || '',
                    "Email": customer.email || '',
                    "Ounces": manifest.total_weight_oz || 0,
                    "Package": manifest.package_type || '',
                    "Length": manifest.package_length || 0,
                    "Width": manifest.package_width || 0,
                    "Height": columns.includes("Height") ? (manifest.package_height || 0) : '',
                };
            });
        };
        

        // Generate CSV strings
        const polymailerCsvData = mapToCsvData(polymailerData, polymailerColumns);
        const boxCsvData = mapToCsvData(boxData, boxColumns);

        const polymailerCsvString = polymailerCsvData.length > 0 ? stringify(polymailerCsvData, { header: true, columns: polymailerColumns }) : null;
        const boxCsvString = boxCsvData.length > 0 ? stringify(boxCsvData, { header: true, columns: boxColumns }) : null;

        let csvSent = false;

        // Function to send CSV data
        const sendCsv = (csvString, filename) => {
            if (csvString) {
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
                res.status(200).send(csvString);
                csvSent = true;
            }
        };

        // Send CSV files
        if (polymailerCsvString) {
            const filename = `pirateship_export_polymailers_GO${groupOrderId}_${new Date().toISOString().split('T')[0]}.csv`;
            sendCsv(polymailerCsvString, filename);
        }
        if (boxCsvString) {
            const filename = `pirateship_export_boxes_GO${groupOrderId}_${new Date().toISOString().split('T')[0]}.csv`;
            sendCsv(boxCsvString, filename);
        }

        if (!csvSent) {
            return res.status(404).send({ message: `No orders found for Group Order ${groupOrderId} with relevant package types.` });
        }

    } catch (err) {
        res.status(500).send({
            message: err.message || "Some error occurred while exporting orders."
        });
    }
};

exports.markAsPaid = async (req, res) => {
    const { customerId, groupOrderId } = req.body;

    if (!customerId || !groupOrderId) {
        return res.status(400).send({ message: "Customer ID and Group Order ID are required." });
    }

    const t = await db.sequelize.transaction();

    try {
        const orders = await Order.findAll({
            where: {
                customer_id: customerId,
                group_order_id: groupOrderId,
                payment_status: {
                    [Op.in]: ['Payment Claimed', 'Invoice Sent']
                }
            },
            transaction: t
        });

        if (orders.length === 0) {
            await t.commit();
            return res.status(404).send({ message: "No 'Payment Claimed' or 'Invoice Sent' orders found for this customer and group order." });
        }

        const orderIds = orders.map(order => order.id);

        await Order.update(
            { payment_status: 'Paid' },
            { where: { id: { [Op.in]: orderIds } }, transaction: t }
        );

        const allPaidOrders = await Order.findAll({
            where: {
                customer_id: customerId,
                group_order_id: groupOrderId,
                payment_status: 'Paid'
            },
            include: [{
                model: OrderItem,
                as: 'orderItems',
                include: [{
                    model: Product,
                    as: 'orderProduct'
                }]
            }],
            transaction: t
        });

        const customer = await Customer.findByPk(customerId, { transaction: t });
        if (!customer || !customer.facebook_psid) {
            throw new Error("Customer PSID not found.");
        }

        // Consolidate all items from all paid orders
        const consolidatedItems = {};
        let totalShipping = 0;
        let totalAppliedCredit = 0;

        allPaidOrders.forEach(order => {
            order.orderItems.forEach(item => {
                if (consolidatedItems[item.product_id]) {
                    consolidatedItems[item.product_id].quantity += item.quantity;
                } else {
                    consolidatedItems[item.product_id] = {
                        name: item.orderProduct.name,
                        quantity: item.quantity,
                        price: item.price_at_order_time
                    };
                }
            });
            totalShipping += parseFloat(order.shipping_cost);
            totalAppliedCredit += parseFloat(order.applied_credit);
        });

        const paymentVerifiedMessage = "Great news! Your payment has been verified. Thanks for your order! If you have any questions, please message Naomi directly https://m.me/naomi.seijo.2025";
        await callSendAPI(customer.facebook_psid, { text: paymentVerifiedMessage }, 'POST_PURCHASE_UPDATE');

        let summaryTitle = allPaidOrders.length > 1 ? "Here is your updated consolidated order summary:\n\n" : "Here is your order summary:\n\n";
        let summaryText = summaryTitle;
        let subtotal = 0;
        Object.values(consolidatedItems).forEach(item => {
            const lineTotal = item.quantity * item.price;
            subtotal += lineTotal;
            summaryText += `- ${item.name} (Qty: ${item.quantity}): $${lineTotal.toFixed(2)}\n`;
        });

        const grandTotal = subtotal + totalShipping - totalAppliedCredit;

        summaryText += `\nSubtotal: $${subtotal.toFixed(2)}`;
        summaryText += `\nShipping: $${totalShipping.toFixed(2)}`;
        if (totalAppliedCredit > 0) {
            summaryText += `\nCredit Applied: -$${totalAppliedCredit.toFixed(2)}`;
        }
        summaryText += `\nTotal: $${grandTotal.toFixed(2)}`;

        await callSendAPI(customer.facebook_psid, { text: summaryText }, 'POST_PURCHASE_UPDATE');

        await t.commit();

        res.send({ message: "Orders marked as paid and consolidated summary sent." });

    } catch (error) {
        await t.rollback();
        console.error("Error in markAsPaid:", error);
        res.status(500).send({ message: "Error processing request: " + error.message });
    }
};
