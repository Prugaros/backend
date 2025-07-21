const db = require("../models");
const Customer = db.Customer;
const GroupOrder = db.GroupOrder;
const Product = db.Product;
const Order = db.Order; // Added
const OrderItem = db.OrderItem; // Added
const { Op } = require("sequelize");
const { callSendAPI, updateCustomerState, getCustomerAndState } = require("./facebook.webhook.controller"); // Import necessary functions


// Get data needed for the order webview
exports.getOrderData = async (req, res) => {
    const psid = req.query.psid;

    if (!psid) {
        return res.status(400).send({ message: "Missing PSID." });
    }

    try {
        const customer = await Customer.findOne({ where: { facebook_psid: psid } });
        if (!customer) {
            return res.status(404).send({ message: "Customer not found." });
        }

        // Allow access even if state isn't exactly ORDERING_SELECT_PRODUCT,
        // as user might open it while in AWAITING_ADDRESS etc.
        // We primarily need the groupOrderId from the state data.
        const currentData = customer.conversation_data || {};
        const groupOrderId = currentData.groupOrderId;

        if (!groupOrderId) {
             console.error(`Group Order ID missing from customer state for PSID ${psid}`);
             // Maybe allow access but show an error message in the webview?
             return res.status(403).send({ message: "Cannot determine active group order context." });
        }

        const { name } = req.query;
        const whereClause = { is_active: true };
        if (name) {
            whereClause.name = { [Op.like]: `%${name}%` };
        }

        const groupOrder = await GroupOrder.findByPk(groupOrderId, {
            include: [{
                model: Product,
                as: 'products',
                where: whereClause,
                required: false,
                attributes: ['id', 'name', 'description', 'price', 'images', 'collectionId'],
                include: [{
                    model: db.Collection,
                    as: 'collection',
                    attributes: ['Name', 'DisplayOrder']
                }],
            }],
            raw: false // Ensure getters are applied for the main query and included models
        });

        if (!groupOrder || groupOrder.status !== 'Active') {
            return res.status(404).send({ message: "Active group order not found." });
        }

        // Normalize currentCart before sending to frontend
        const normalizedCurrentCart = {};
        Object.entries(currentData.currentOrderItems || {}).forEach(([productId, itemData]) => {
            normalizedCurrentCart[productId] = typeof itemData === 'object' ? itemData.quantity : itemData;
        });
        // Ensure products are converted to JSON with getters applied, and explicitly parse images if still a string
        const productsToSend = groupOrder.products.map(product => {
            const productJson = product.toJSON({ getters: true });
            if (typeof productJson.images === 'string') {
                try {
                    productJson.images = JSON.parse(productJson.images);
                } catch (e) {
                    console.error("Error parsing images string:", e);
                    productJson.images = []; // Default to empty array on parse error
                }
            }
            return productJson;
        });

        console.log(`[getOrderData] Products being sent for PSID ${psid}:`, productsToSend);
        console.log(`[getOrderData] Sending normalized currentCart for PSID ${psid}:`, normalizedCurrentCart);
        res.send({
            groupOrderName: groupOrder.name,
            products: productsToSend || [],
            currentCart: normalizedCurrentCart
        });

    } catch (error) {
        console.error(`Error fetching webview order data for PSID ${psid}:`, error);
        res.status(500).send({ message: "Error retrieving order data." });
    }
};

// Finalize order from webview and trigger bot's next step
exports.finalizeOrder = async (req, res) => {
    const psid = req.query.psid; // PSID should be passed as a query parameter

    if (!psid) {
        return res.status(400).send({ message: "Missing PSID." });
    }

    try {
        const customer = await getCustomerAndState(psid); // Use the shared getCustomerAndState
        let currentData = customer.conversation_data || {};

        if (Object.keys(currentData.currentOrderItems || {}).length === 0) {
            // If cart is empty, send a message to the user and respond to frontend
            await callSendAPI(psid, { text: "You haven't added any items to your cart. Please add items before submitting your order." });
            return res.status(400).send({ message: "Cart is empty." });
        }

        let subtotal = 0;
        Object.values(currentData.currentOrderItems).forEach(item => { subtotal += item.price * item.quantity; });
        let shippingCost = 5.00; // Default shipping cost

        // Check if customer has existing *paid* orders for the same group order
        const existingPaidOrders = await Order.findAll({
            where: {
                customer_id: currentData.customerId,
                group_order_id: currentData.groupOrderId,
                payment_status: { [Op.in]: ['Payment Claimed', 'Paid'] }
            }
        });

        // If no existing paid orders, charge shipping
        if (existingPaidOrders && existingPaidOrders.length === 0) {
            shippingCost = 5.00;
        } else {
            shippingCost = 0.00; // Set shipping to $0 if existing *paid* order found
        }

        const totalAmount = subtotal + shippingCost;

        const order = await Order.create({
            customer_id: currentData.customerId, group_order_id: currentData.groupOrderId,
            total_amount: totalAmount, shipping_cost: shippingCost, payment_status: "Invoice Sent"
        });
        const orderItemsToCreate = Object.values(currentData.currentOrderItems).map(item => ({
            order_id: order.id, product_id: item.productId,
            quantity: item.quantity, price_at_order_time: item.price
        }));
        await OrderItem.bulkCreate(orderItemsToCreate);

        let invoiceText = `Okay, here's your order summary:\n\n`; // Default text
        if (existingPaidOrders && existingPaidOrders.length > 0) {
            invoiceText = "Okay, here's the addition to your existing order:\n\n";
        }

        Object.values(currentData.currentOrderItems).forEach(item => {
            invoiceText += `- ${item.name} (Qty: ${item.quantity}): $${(item.price * item.quantity).toFixed(2)}\n`;
        });
        invoiceText += `\nSubtotal: $${subtotal.toFixed(2)}\nShipping: $${shippingCost.toFixed(2)}\nTotal: $${totalAmount.toFixed(2)}`;

        const responseMessage = {
            text: invoiceText + "\n\nPlease confirm your order details above.",
            quick_replies: [
                { content_type: "text", title: "👍 Confirm", payload: `CONFIRM_ORDER:${order.id}` },
                { content_type: "text", title: "✏️ Edit", payload: `EDIT_ORDER:${order.id}` },
                { content_type: "text", title: "❌ Cancel", payload: `CANCEL_ORDER:${order.id}` }
            ]
        };

        currentData.orderId = order.id;
        // currentData.currentOrderItems = {}; // Clear cart from state - do not clear here, let the bot handle it after confirmation
        await updateCustomerState(customer, "AWAITING_ORDER_CONFIRMATION", currentData);
        await callSendAPI(psid, responseMessage);

        res.status(200).send({ message: "Order finalized and message sent to Messenger." });

    } catch (error) {
        console.error(`Error finalizing order for PSID ${psid}:`, error);
        res.status(500).send({ message: "Error finalizing order." });
    }
};

// Update the user's cart state from the webview
exports.updateCart = async (req, res) => {
    const psid = req.query.psid;
    const cartItems = req.body.items; // Expecting format like { productId: quantity, ... }

     if (!psid) {
        return res.status(400).send({ message: "Missing PSID." });
    }
     if (!cartItems || typeof cartItems !== 'object') {
         return res.status(400).send({ message: "Invalid cart items data." });
     }

    try {
        const customer = await Customer.findOne({ where: { facebook_psid: psid } });
        if (!customer) {
            return res.status(404).send({ message: "Customer not found." });
        }

        // Allow cart updates as long as there's group order context
        let currentData = customer.conversation_data || {};
        if (!currentData.groupOrderId) {
             return res.status(403).send({ message: "Missing group order context." });
        }

        console.log(`[updateCart] Received cartItems for PSID ${psid}:`, cartItems);
        let currentOrderItems = currentData.currentOrderItems || {};

        // Normalize incoming cartItems and merge with existing cart
        Object.entries(cartItems).forEach(([productId, itemData]) => {
            const quantity = typeof itemData === 'object' ? itemData.quantity : itemData;
            if (!isNaN(quantity) && quantity > 0) {
                currentOrderItems[productId] = quantity; // Store only quantity
            } else {
                delete currentOrderItems[productId]; // Remove if quantity is 0 or invalid
            }
        });

        currentData.currentOrderItems = currentOrderItems;
        // Update state, keeping the existing state name (e.g., ORDERING_SELECT_PRODUCT)
        await updateCustomerState(customer, customer.conversation_state, currentData);
        console.log(`[updateCart] Saved currentOrderItems for PSID ${psid}:`, currentData.currentOrderItems);

        res.send({ message: "Cart updated successfully." });

    } catch (error) {
         console.error(`Error updating cart for PSID ${psid}:`, error);
        res.status(500).send({ message: "Error updating cart." });
    }
};
