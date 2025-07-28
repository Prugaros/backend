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

        const currentData = customer.conversation_data || {};
        const groupOrderId = currentData.groupOrderId;

        if (!groupOrderId) {
            console.error(`Group Order ID missing from customer state for PSID ${psid}`);
            return res.status(403).send({ message: "Cannot determine active group order context." });
        }

        const groupOrder = await GroupOrder.findByPk(groupOrderId);
        if (!groupOrder || groupOrder.status !== 'Active') {
            return res.status(404).send({ message: "Active group order not found." });
        }

        // Fetch only brand information initially
        const brands = await db.Brand.findAll({
            where: { isActive: true },
            order: [['displayOrder', 'ASC']],
            attributes: ['id', 'name'] // Only fetch necessary fields
        });

        // Normalize currentCart before sending to frontend
        const normalizedCurrentCart = {};
        Object.entries(currentData.currentOrderItems || {}).forEach(([productId, itemData]) => {
            normalizedCurrentCart[productId] = typeof itemData === 'object' ? itemData.quantity : itemData;
        });

        res.send({
            groupOrderName: groupOrder.name,
            brands: brands,
            currentCart: normalizedCurrentCart
        });

    } catch (error) {
        console.error(`Error fetching initial webview order data for PSID ${psid}:`, error);
        res.status(500).send({ message: "Error retrieving initial order data." });
    }
};

// Get featured items data
exports.getFeaturedData = async (req, res) => {
    try {
        const featuredCollections = await db.Collection.findAll({
            where: { is_featured: true, isActive: true, '$brand.isActive$': true },
            include: [
                { 
                    model: db.Product, 
                    as: 'products', 
                    where: { is_active: true }, 
                    required: false 
                },
                { 
                    model: db.Brand, 
                    as: 'brand', 
                    attributes: ['name', 'isActive'],
                    where: { isActive: true }
                }
            ],
            order: [['displayOrder', 'ASC']]
        });

        // Extract product IDs from the featured collections to exclude them from "other" featured items
        const productIdsInFeaturedCollections = featuredCollections.flatMap(c => c.products.map(p => p.id));

        const otherFeaturedItems = await db.Product.findAll({
            where: {
                is_featured: true,
                is_active: true,
                id: { [Op.notIn]: productIdsInFeaturedCollections }, // Exclude products in featured collections
                '$brand.isActive$': true
            },
            include: [
                { 
                    model: db.Brand, 
                    as: 'brand', 
                    attributes: ['name', 'isActive'],
                    where: { isActive: true }
                },
                {
                    model: db.Collection,
                    as: 'collection',
                    where: { isActive: true },
                    required: false // Use left join to include products with no collection
                }
            ]
        });

        // Further filter to exclude items whose collection is featured, even if the item itself is marked as featured
        const finalOtherFeaturedItems = otherFeaturedItems.filter(p => !p.collection || !p.collection.is_featured);

        res.send({
            featuredCollections: featuredCollections.map(c => c.toJSON()),
            otherFeaturedItems: finalOtherFeaturedItems.map(p => p.toJSON())
        });
    } catch (error) {
        console.error(`Error fetching featured data:`, error);
        res.status(500).send({ message: "Error retrieving featured data." });
    }
};

// Get data for a specific brand
exports.getBrandData = async (req, res) => {
    const brandId = req.params.brandId;
    if (!brandId) {
        return res.status(400).send({ message: "Missing Brand ID." });
    }

    try {
        const brand = await db.Brand.findByPk(brandId);
        if (!brand || !brand.isActive) { // Also check if brand is active
            return res.status(404).send({ message: "Brand not found or is inactive." });
        }

        // Fetch all collections for the brand, including their products
        const allCollections = await db.Collection.findAll({
            where: { brandId: brandId },
            include: [{
                model: db.Product,
                as: 'products',
                where: { is_active: true },
                required: false,
            }],
            order: [['displayOrder', 'ASC']]
        });

        // Separate active and inactive collections
        const activeCollections = allCollections.filter(c => c.isActive);
        const inactiveCollections = allCollections.filter(c => !c.isActive);

        // Collect all products from inactive collections
        const productsFromInactiveCollections = inactiveCollections.flatMap(c => c.products || []);

        // Fetch other products that don't belong to any collection
        const productsWithNoCollection = await db.Product.findAll({
            where: {
                brandId: brandId,
                is_active: true,
                collectionId: { [Op.is]: null }
            }
        });

        // Combine products from inactive collections and those with no collection
        const otherBrandItems = [...productsFromInactiveCollections, ...productsWithNoCollection];

        const responseData = {
            ...brand.toJSON(),
            collections: activeCollections.map(c => c.toJSON()),
            otherBrandItems: otherBrandItems.map(p => p.toJSON())
        };

        res.send(responseData);
    } catch (error) {
        console.error(`Error fetching brand data for brandId ${brandId}:`, error);
        res.status(500).send({ message: "Error retrieving brand data." });
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
        const cartItems = currentData.currentOrderItems || {};

        if (Object.keys(cartItems).length === 0) {
            // If cart is empty, send a message to the user and respond to frontend
            await callSendAPI(psid, { text: "You haven't added any items to your cart. Please add items before submitting your order." });
            return res.status(400).send({ message: "Cart is empty." });
        }

        // Get product details for items in cart
        const productIds = Object.keys(cartItems);
        const products = await Product.findAll({
            where: {
                id: { [Op.in]: productIds }
            }
        });

        const productMap = products.reduce((map, product) => {
            map[product.id] = product;
            return map;
        }, {});

        let subtotal = 0;
        const detailedOrderItems = Object.entries(cartItems).map(([productId, quantity]) => {
            const product = productMap[productId];
            if (!product) {
                // This case should ideally not happen if cart is synced correctly
                throw new Error(`Product with ID ${productId} not found.`);
            }
            subtotal += parseFloat(product.price) * quantity;
            return {
                productId: productId,
                quantity: quantity,
                price: product.price,
                name: product.name
            };
        });

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
        if (existingPaidOrders && existingPaidOrders.length > 0) {
            shippingCost = 0.00; // Set shipping to $0 if existing *paid* order found
        } else {
            shippingCost = 5.00;
        }

        const totalAmount = subtotal + shippingCost;

        const order = await Order.create({
            customer_id: currentData.customerId,
            group_order_id: currentData.groupOrderId,
            total_amount: totalAmount,
            shipping_cost: shippingCost,
            payment_status: "Invoice Sent"
        });

        const orderItemsToCreate = detailedOrderItems.map(item => ({
            order_id: order.id,
            product_id: item.productId,
            quantity: item.quantity,
            price_at_order_time: item.price
        }));

        await OrderItem.bulkCreate(orderItemsToCreate);

        let invoiceText = `Okay, here's your order summary:\n\n`; // Default text
        if (existingPaidOrders && existingPaidOrders.length > 0) {
            invoiceText = "Okay, here's the addition to your existing order:\n\n";
        }

        detailedOrderItems.forEach(item => {
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
        
        // Update currentOrderItems in conversation_data to be the detailed version
        const newCartData = {};
        detailedOrderItems.forEach(item => {
            newCartData[item.productId] = {
                quantity: item.quantity,
                price: item.price,
                name: item.name,
                productId: item.productId // Keep productId for consistency
            };
        });
        currentData.currentOrderItems = newCartData;

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
        
        // Replace the entire cart with the new one from the frontend
        const newCart = {};
        Object.entries(cartItems).forEach(([productId, quantity]) => {
            if (!isNaN(quantity) && quantity > 0) {
                newCart[productId] = quantity;
            }
        });

        currentData.currentOrderItems = newCart;
        // Update state, keeping the existing state name (e.g., ORDERING_SELECT_PRODUCT)
        await updateCustomerState(customer, customer.conversation_state, currentData);
        console.log(`[updateCart] Saved currentOrderItems for PSID ${psid}:`, currentData.currentOrderItems);

        res.send({ message: "Cart updated successfully." });

    } catch (error) {
         console.error(`Error updating cart for PSID ${psid}:`, error);
        res.status(500).send({ message: "Error updating cart." });
    }
};
