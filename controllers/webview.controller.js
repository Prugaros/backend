const db = require("../models");
const Customer = db.Customer;
const GroupOrder = db.GroupOrder;
const Product = db.Product;
const Order = db.Order; // Added
const OrderItem = db.OrderItem; // Added
const StoreCredit = db.StoreCredit;
const sequelize = db.sequelize;
const { Op } = require("sequelize");
const { updateCustomerState, getCustomerAndState, clearCustomerState, sendOrderSummaryMessage } = require("./facebook.webhook.controller"); // Import necessary functions
const { applyCreditToOrder } = require("./storeCredit.controller");
const { callSendAPI, setUserPersistentMenu } = require("../utils/facebookApi");


// Helper to validate cart items
async function validateAndPruneCart(customer) {
    let cartItems = customer.persistent_cart || {};
    if (Object.keys(cartItems).length === 0) return { validCart: cartItems, prunedNames: [] };

    const productIds = Object.keys(cartItems);
    // We need all products to get their names for the notification
    const products = await Product.findAll({
        where: { id: { [Op.in]: productIds } },
        include: [{ model: db.Brand, as: 'brand', attributes: ['isActive'] }]
    });

    const validCart = {};
    const prunedNames = [];

    for (const pid of productIds) {
        const product = products.find(p => p.id.toString() === pid.toString());
        // Cart item is invalid if: product doesn't exist, is inactive, or its brand is inactive
        if (product && product.is_active && product.brand && product.brand.isActive) {
            validCart[pid] = cartItems[pid];
        } else {
            // Save the name for the notification (fallback to 'Unknown Item' if deleted from DB)
            prunedNames.push(product ? product.name : 'Unknown Item');
        }
    }

    if (prunedNames.length > 0) {
        customer.persistent_cart = validCart;
        await customer.save();
    }

    return { validCart, prunedNames };
}

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

        // Validate and normalize currentCart before sending to frontend
        const { validCart, prunedNames } = await validateAndPruneCart(customer);
        const normalizedCurrentCart = {};
        Object.entries(validCart).forEach(([productId, itemData]) => {
            normalizedCurrentCart[productId] = typeof itemData === 'object' ? itemData.quantity : itemData;
        });

        const hasActiveCart = Object.keys(normalizedCurrentCart).length > 0;
        
        let hasSubmittedOrderForActiveGroupOrder = false;
        // Suppress decision screen if there is an active cart
        if (!hasActiveCart) {
            const existingSubmittedOrder = await Order.findOne({
                where: {
                    customer_id: customer.id,
                    group_order_id: groupOrderId,
                    payment_status: { [Op.notIn]: ['Cancelled'] },
                    id: { [Op.ne]: currentData.orderId || -1 }
                }
            });
            hasSubmittedOrderForActiveGroupOrder = !!existingSubmittedOrder;
        }

        res.send({
            groupOrderName: groupOrder.name,
            brands: brands,
            currentCart: normalizedCurrentCart,
            prunedItems: prunedNames, // Send to frontend to trigger popup
            hasSubmittedOrderForActiveGroupOrder
        });

    } catch (error) {
        console.error(`Error in getOrderData for PSID ${psid}:`, error);
        res.status(500).send({ message: "Error gathering order data." });
    }
};

// Get order summary for the payment page
exports.getOrderSummary = async (req, res) => {
    const psid = req.query.psid;
    if (!psid) {
        return res.status(400).send({ message: "Missing PSID." });
    }
    try {
        const { customer } = await getCustomerAndState(psid);
        if (!customer) {
            return res.status(404).send({ message: "Customer not found." });
        }

        let hasPaidOrders = false;
        const currentData = customer.conversation_data || {};
        const orderId = currentData.orderId;

        if (!orderId) {
            return res.status(404).send({ message: "Order not found." });
        }

        const order = await Order.findByPk(orderId, {
            include: [{
                model: OrderItem,
                as: 'orderItems',
                include: [{
                    model: Product,
                    as: 'orderProduct'
                }]
            }]
        });

        if (!order) {
            return res.status(404).send({ message: "Order not found." });
        }

        const subtotal = order.orderItems.reduce((sum, item) => sum + (item.quantity * item.price_at_order_time), 0);
        let totalAmount = subtotal + parseFloat(order.shipping_cost);
        let appliedCredit = 0;

        if (customer.credit > 0) {
            appliedCredit = Math.min(totalAmount, parseFloat(customer.credit));
            totalAmount -= appliedCredit;
        }

        const orderSummary = {
            items: order.orderItems.map(item => ({
                name: item.orderProduct.name,
                quantity: item.quantity,
                lineTotal: (item.quantity * item.price_at_order_time).toFixed(2)
            })),
            subtotal: subtotal.toFixed(2),
            shipping: order.shipping_cost.toFixed(2),
            appliedCredit: appliedCredit.toFixed(2),
            total: totalAmount.toFixed(2)
        };

        res.send({ orderSummary });
    } catch (error) {
        console.error(`Error fetching order summary for PSID ${psid}:`, error);
        res.status(500).send({ message: "Error retrieving order summary." });
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

// Get all active products from all active brands (used for global search)
exports.getAllProducts = async (req, res) => {
    try {
        const products = await db.Product.findAll({
            where: { is_active: true, '$brand.isActive$': true },
            include: [
                {
                    model: db.Brand,
                    as: 'brand',
                    attributes: ['id', 'name', 'isActive'],
                    where: { isActive: true }
                },
                {
                    model: db.Collection,
                    as: 'collection',
                    attributes: ['id', 'name'],
                    required: false
                }
            ],
            order: [['name', 'ASC']]
        });
        res.send({ products: products.map(p => p.toJSON()) });
    } catch (error) {
        console.error('Error fetching all products for search:', error);
        res.status(500).send({ message: "Error retrieving products." });
    }
};

// Get customer address and order summary
exports.getAddress = async (req, res) => {
    const psid = req.query.psid;
    if (!psid) {
        return res.status(400).send({ message: "Missing PSID." });
    }
    try {
        const { customer } = await getCustomerAndState(psid);
        if (!customer) {
            return res.status(404).send({ message: "Customer not found." });
        }

        const currentData = customer.conversation_data || {};
        const { validCart: cartItems, prunedNames } = await validateAndPruneCart(customer);
        let orderSummary = {
            items: [],
            subtotal: 0,
            shipping: 0,
            total: 0
        };

        if (Object.keys(cartItems).length > 0) {
            const productIds = Object.keys(cartItems);
            const products = await Product.findAll({ where: { id: { [Op.in]: productIds } } });
            const productMap = products.reduce((map, product) => {
                map[product.id] = product;
                return map;
            }, {});

            let subtotal = 0;
            const detailedOrderItems = Object.entries(cartItems).map(([productId, itemData]) => {
                const quantity = typeof itemData === 'object' && itemData !== null ? itemData.quantity : itemData;
                const product = productMap[productId];
                if (!product) return null;
                subtotal += parseFloat(product.price) * quantity;
                return {
                    name: product.name,
                    quantity: quantity,
                    price: product.price,
                    lineTotal: (parseFloat(product.price) * quantity).toFixed(2)
                };
            }).filter(Boolean);

            const existingPaidOrders = await Order.findAll({
                where: {
                    customer_id: currentData.customerId,
                    group_order_id: currentData.groupOrderId,
                    payment_status: { [Op.in]: ['Payment Claimed', 'Paid'] }
                }
            });
            hasPaidOrders = existingPaidOrders.length > 0;

            let shippingCost = hasPaidOrders ? 0.00 : 5.50;
            if (customer.country && customer.country !== 'United States') {
                const totalQuantity = detailedOrderItems.reduce((sum, item) => sum + item.quantity, 0);
                shippingCost = totalQuantity * 1.70;
            }
            let totalAmount = subtotal + shippingCost;
            let appliedCredit = 0;

            if (customer.credit > 0) {
                appliedCredit = Math.min(totalAmount, parseFloat(customer.credit));
                totalAmount -= appliedCredit;
            }

            orderSummary = {
                items: detailedOrderItems,
                subtotal: subtotal.toFixed(2),
                shipping: shippingCost.toFixed(2),
                appliedCredit: appliedCredit.toFixed(2),
                total: totalAmount.toFixed(2)
            };
        }

        res.send({
            address: {
                name: customer.name || '',
                email: customer.email || '',
                street_address: customer.street_address || '',
                city: customer.city || '',
                state: customer.state || '',
                zip: customer.zip || '',
                country: customer.country || 'United States',
                international_address_block: customer.international_address_block || ''
            },
            orderSummary: orderSummary,
            hasPaidOrders: hasPaidOrders,
            prunedItems: prunedNames // Send to frontend to trigger popup
        });
    } catch (error) {
        console.error(`Error fetching address and order summary for PSID ${psid}:`, error);
        res.status(500).send({ message: "Error retrieving data." });
    }
};

// Save customer address
exports.saveAddress = async (req, res) => {
    const psid = req.query.psid;
    if (!psid) {
        return res.status(400).send({ message: "Missing PSID." });
    }
    try {
        const customer = await Customer.findOne({ where: { facebook_psid: psid } });
        if (!customer) {
            return res.status(404).send({ message: "Customer not found." });
        }

        const { name, email, street_address, city, state, zip, country, international_address_block } = req.body;
        customer.name = name;
        customer.email = email;
        customer.country = country;

        if (country === 'United States') {
            customer.street_address = street_address;
            customer.city = city;
            customer.state = state;
            customer.zip = zip;
            customer.is_international = false;
            customer.international_address_block = null;
        } else {
            customer.street_address = null;
            customer.city = null;
            customer.state = null;
            customer.zip = null;
            customer.is_international = true;
            customer.international_address_block = international_address_block;
        }

        await customer.save();

        const currentData = customer.conversation_data || {};
        const orderId = currentData.orderId;

        if (orderId) {
            const order = await Order.findByPk(orderId, {
                include: [{ model: OrderItem, as: 'orderItems' }]
            });

            if (order) {
                let shippingCost = order.shipping_cost;
                if (customer.country !== 'United States') {
                    const totalQuantity = order.orderItems.reduce((sum, item) => sum + item.quantity, 0);
                    shippingCost = totalQuantity * 1.70;
                } else {
                    const existingPaidOrders = await Order.findAll({
                        where: {
                            customer_id: currentData.customerId,
                            group_order_id: currentData.groupOrderId,
                            payment_status: { [Op.in]: ['Payment Claimed', 'Paid'] }
                        }
                    });
                    shippingCost = existingPaidOrders.length > 0 ? 0.00 : 5.50;
                }

                const subtotal = order.orderItems.reduce((sum, item) => sum + (item.quantity * item.price_at_order_time), 0);
                const totalAmount = subtotal + shippingCost;

                await order.update({
                    shipping_cost: shippingCost,
                    total_amount: totalAmount
                });
            }
        }

        // Since the order is already created, we just need to update the state
        await updateCustomerState(customer, "AWAITING_PAYMENT_CONFIRMATION");

        res.status(200).send({ message: "Address saved and state updated." });

    } catch (error) {
        console.error(`Error saving address for PSID ${psid}:`, error);
        res.status(500).send({ message: error.message || "Error saving address." });
    }
};

// Update the user's cart state from the webview
exports.updateCart = async (req, res) => {
    const psid = req.query.psid;
    const cartItems = req.body.items;

    if (!psid) {
        return res.status(400).send({ message: "Missing PSID." });
    }
    if (!cartItems || typeof cartItems !== 'object') {
        return res.status(400).send({ message: "Invalid cart items data." });
    }

    try {
        const { customer } = await getCustomerAndState(psid);
        let currentData = customer.conversation_data || {};
        if (!currentData.groupOrderId) {
            return res.status(403).send({ message: "Missing group order context." });
        }

        const newCart = {};
        Object.entries(cartItems).forEach(([productId, quantity]) => {
            if (!isNaN(quantity) && quantity > 0) {
                newCart[productId] = quantity;
            }
        });

        customer.persistent_cart = newCart;
        await customer.save();

        if (Object.keys(newCart).length > 0) {
            // Cart has items, create/update order and set state to AWAITING_ORDER_CONFIRMATION
            const productIds = Object.keys(newCart);
            const products = await Product.findAll({ where: { id: { [Op.in]: productIds } } });
            const productMap = products.reduce((map, product) => {
                map[product.id] = product;
                return map;
            }, {});

            let subtotal = 0;
            const detailedOrderItems = Object.entries(newCart).map(([productId, quantity]) => {
                const product = productMap[productId];
                if (!product) throw new Error(`Product with ID ${productId} not found.`);
                subtotal += parseFloat(product.price) * quantity;
                return { productId, quantity, price: product.price, name: product.name };
            });

            const existingPaidOrders = await Order.findAll({
                where: {
                    customer_id: currentData.customerId,
                    group_order_id: currentData.groupOrderId,
                    payment_status: { [Op.in]: ['Payment Claimed', 'Paid'] }
                }
            });
            const shippingCost = existingPaidOrders.length > 0 ? 0.00 : 5.50;
            const totalAmount = subtotal + shippingCost;

            let order = null;
            if (currentData.orderId) {
                order = await Order.findOne({
                    where: {
                        id: currentData.orderId,
                        customer_id: currentData.customerId,
                        group_order_id: currentData.groupOrderId,
                        payment_status: { [Op.notIn]: ['Paid', 'Cancelled', 'Payment Claimed'] }
                    }
                });
            }

            if (order) {
                await order.update({
                    total_amount: totalAmount,
                    shipping_cost: shippingCost,
                    payment_status: "Invoice Sent"
                });
                await OrderItem.destroy({ where: { order_id: order.id } });
            } else {
                order = await Order.create({
                    customer_id: currentData.customerId,
                    group_order_id: currentData.groupOrderId,
                    total_amount: totalAmount,
                    shipping_cost: shippingCost,
                    payment_status: "Invoice Sent"
                });
            }

            const orderItemsToCreate = detailedOrderItems.map(item => ({
                order_id: order.id,
                product_id: item.productId,
                quantity: item.quantity,
                price_at_order_time: item.price
            }));
            await OrderItem.bulkCreate(orderItemsToCreate);

            currentData.orderId = order.id;
            await updateCustomerState(customer, "AWAITING_ORDER_CONFIRMATION", currentData);
            res.send({ message: "Cart updated and state set to AWAITING_ORDER_CONFIRMATION." });

        } else {
            // Cart is empty, destroy order and set state to ORDERING_SELECT_PRODUCT
            let order = await Order.findOne({
                where: {
                    customer_id: currentData.customerId,
                    group_order_id: currentData.groupOrderId,
                    payment_status: { [Op.notIn]: ['Paid', 'Cancelled', 'Payment Claimed'] }
                }
            });
            if (order) {
                await Order.destroy({ where: { id: order.id } });
            }
            if (currentData.orderId) {
                delete currentData.orderId;
            }
            await updateCustomerState(customer, "ORDERING_SELECT_PRODUCT", currentData);
            res.send({ message: "Cart is empty, state set to ORDERING_SELECT_PRODUCT." });
        }
    } catch (error) {
        console.error(`Error updating cart for PSID ${psid}:`, error);
        res.status(500).send({ message: "Error updating cart." });
    }
};

exports.submitAddress = async (req, res) => {
    const { psid } = req.body;
    if (!psid) {
        return res.status(400).send({ message: "Missing PSID." });
    }
    try {
        const { customer } = await getCustomerAndState(psid);
        
        let currentData = customer.conversation_data || {};
        
        customer.persistent_cart = {};
        
        await updateCustomerState(customer, "AWAITING_PAYMENT_CONFIRMATION", currentData);
        res.status(200).send({ message: "State updated to AWAITING_PAYMENT_CONFIRMATION and cart cleared." });
    } catch (error) {
        console.error(`Error in submitAddress for PSID ${psid}:`, error);
        res.status(500).send({ message: "Error updating state." });
    }
};

exports.paymentSent = async (req, res) => {
    const { psid } = req.body;
    if (!psid) {
        return res.status(400).send({ message: "Missing PSID." });
    }
    const t = await sequelize.transaction();
    try {
        const { customer } = await getCustomerAndState(psid);
        const orderId = customer.conversation_data.orderId;
        if (orderId) {
            const order = await Order.findByPk(orderId, { transaction: t });
            const { appliedCredit, newTotal } = await applyCreditToOrder(orderId, t);
            await Order.update({ payment_status: 'Payment Claimed' }, { where: { id: orderId, customer_id: customer.id }, transaction: t });

            if (appliedCredit > 0) {
                const updatedCustomer = await Customer.findByPk(customer.id, { transaction: t });
                const message = {
                    text: `You've claimed $${appliedCredit.toFixed(2)} in store credit. You have $${updatedCustomer.credit.toFixed(2)} remaining.`
                };
                await callSendAPI(psid, message);
            }
        }
        await clearCustomerState(customer, t);
        await t.commit();
        res.status(200).send({ message: "Payment marked as claimed and state cleared." });
    } catch (error) {
        await t.rollback();
        console.error(`Error in paymentSent for PSID ${psid}:`, error);
        res.status(500).send({ message: "Error processing payment sent." });
    }
};

exports.getActiveGroupOrders = async (req, res) => {
    try {
        const activeGroupOrders = await GroupOrder.findAll({
            where: { status: 'Active' },
            attributes: ['id', 'name']
        });
        res.send(activeGroupOrders);
    } catch (error) {
        console.error(`Error fetching active group orders:`, error);
        res.status(500).send({ message: "Error fetching active group orders." });
    }
};

exports.setGroupOrder = async (req, res) => {
    const { psid, groupOrderId } = req.body;

    if (!psid || !groupOrderId) {
        return res.status(400).send({ message: "Missing PSID or Group Order ID." });
    }

    try {
        const { customer } = await getCustomerAndState(psid);
        if (!customer) {
            return res.status(404).send({ message: "Customer not found." });
        }

        const currentData = {
            customerId: customer.id,
            groupOrderId: groupOrderId
        };

        await updateCustomerState(customer, "ORDERING_SELECT_PRODUCT", currentData);

        res.send({ message: "Group order context set and state initialized." });
    } catch (error) {
        console.error(`Error in setGroupOrder for PSID ${psid}:`, error);
        res.status(500).send({ message: "Error setting group order." });
    }
};

exports.getDestashProfile = async (req, res) => {
    const psid = req.query.psid;
    if (!psid) return res.status(400).send({ message: "Missing PSID." });

    try {
        const customer = await Customer.findOne({ where: { facebook_psid: psid } });
        if (!customer) return res.status(404).send({ message: "Customer not found." });

        res.send({
            email: customer.email || '',
            wants_destash_notification: customer.wants_destash_notification
        });
    } catch (error) {
        console.error(`Error fetching destash profile for PSID ${psid}:`, error);
        res.status(500).send({ message: "Error retrieving destash profile." });
    }
};

exports.signupDestash = async (req, res) => {
    const { psid, email } = req.body;
    if (!psid || !email) return res.status(400).send({ message: "Missing PSID or Email." });

    try {
        const customer = await Customer.findOne({ where: { facebook_psid: psid } });
        if (!customer) return res.status(404).send({ message: "Customer not found." });

        customer.wants_destash_notification = true;

        if (!customer.email) {
            customer.email = email;
        } else if (customer.email !== email) {
            const data = customer.destash_conversation_data || {};
            data.secondaryEmail = email;
            customer.destash_conversation_data = data;
        }

        await customer.save();

        // Update persistent menu to show the checkmark
        await setUserPersistentMenu(psid);

        res.send({ message: "Successfully signed up for destash notifications!" });
    } catch (error) {
        console.error(`Error signing up for destash for PSID ${psid}:`, error);
        res.status(500).send({ message: "Error signing up for destash." });
    }
};

exports.getOrderStatus = async (req, res) => {
    const psid = req.query.psid;
    if (!psid) return res.status(400).send({ message: "Missing PSID." });

    try {
        const customer = await Customer.findOne({ where: { facebook_psid: psid } });
        if (!customer) return res.status(404).send({ message: "Customer not found." });

        const orders = await db.Order.findAll({
            where: {
                customer_id: customer.id,
                payment_status: { [Op.notIn]: ['Cancelled'] }
            },
            include: [
                {
                    model: db.OrderItem,
                    as: 'orderItems',
                    include: [{
                        model: db.Product,
                        as: 'orderProduct',
                        attributes: ['id', 'name'],
                        paranoid: false
                    }]
                },
                {
                    model: db.GroupOrder,
                    as: 'groupOrder',
                    attributes: ['id', 'name', 'status']
                },
                {
                    model: db.Refund,
                    as: 'refunds',
                    include: [{
                        model: db.Product,
                        as: 'product',
                        attributes: ['id', 'name'],
                        paranoid: false
                    }]
                }
            ],
            order: [['order_date', 'DESC']]
        });

        const groupedOrdersMap = {};

        orders.forEach(order => {
            const goId = order.group_order_id || `no-group-${order.id}`;
            if (!groupedOrdersMap[goId]) {
                groupedOrdersMap[goId] = {
                    id: `group-${goId}`,
                    groupOrderName: order.groupOrder ? order.groupOrder.name : 'Unknown Group Order',
                    groupOrderIsActive: order.groupOrder ? order.groupOrder.status === 'Active' : false,
                    orderDate: order.order_date,
                    itemsMap: {},
                    subtotal: 0,
                    shipping: 0,
                    appliedCredit: 0,
                    total: 0,
                    payment_statuses: new Set(),
                    shipping_statuses: new Set()
                };
            }
            const group = groupedOrdersMap[goId];

            if (new Date(order.order_date) < new Date(group.orderDate)) {
                group.orderDate = order.order_date;
            }

            group.shipping += parseFloat(order.shipping_cost || 0);
            group.appliedCredit += parseFloat(order.applied_credit || 0);
            group.total += parseFloat(order.total_amount || 0);
            group.payment_statuses.add(order.payment_status);
            if (order.shipping_status) {
                group.shipping_statuses.add(order.shipping_status);
            }

            const refundedQtyMap = {};
            (order.refunds || []).forEach(r => {
                refundedQtyMap[r.product_id] = (refundedQtyMap[r.product_id] || 0) + r.quantity;
            });

            order.orderItems.forEach(item => {
                const price = parseFloat(item.price_at_order_time);
                const name = item.orderProduct ? item.orderProduct.name : 'Unknown Item';
                const productId = item.product_id || name;
                const key = `${productId}-${price}`;

                if (!group.itemsMap[key]) {
                    group.itemsMap[key] = {
                        name: name,
                        quantity: 0,
                        price: price,
                        lineTotal: 0,
                        refundedQty: 0
                    };
                }
                group.itemsMap[key].quantity += item.quantity;
                group.itemsMap[key].lineTotal += (item.quantity * price);
                group.itemsMap[key].refundedQty += (refundedQtyMap[item.product_id] || 0);
                
                group.subtotal += (item.quantity * price);
            });
        });

        const formattedOrders = Object.values(groupedOrdersMap).map(group => {
            let payment_status = 'Paid';
            if (group.payment_statuses.has('Error')) payment_status = 'Error';
            else if (group.payment_statuses.has('Invoice Sent')) payment_status = 'Invoice Sent';
            else if (group.payment_statuses.has('Payment Claimed')) payment_status = 'Payment Claimed';

            let shipping_status = 'Pending';
            if (group.shipping_statuses.has('Issue')) shipping_status = 'Issue';
            else if (group.shipping_statuses.has('Pending')) shipping_status = 'Pending';
            else if (group.shipping_statuses.has('Processing')) shipping_status = 'Processing';
            else if (group.shipping_statuses.has('Packed')) shipping_status = 'Packed';
            else if (group.shipping_statuses.has('Shipped')) shipping_status = 'Shipped';
            else if (group.shipping_statuses.has('Delivered')) shipping_status = 'Delivered';

            return {
                id: group.id,
                groupOrderName: group.groupOrderName,
                groupOrderIsActive: group.groupOrderIsActive,
                orderDate: group.orderDate,
                items: Object.values(group.itemsMap).map(i => ({
                    ...i,
                    lineTotal: i.lineTotal.toFixed(2)
                })),
                subtotal: group.subtotal.toFixed(2),
                shipping: group.shipping.toFixed(2),
                appliedCredit: group.appliedCredit.toFixed(2),
                total: group.total.toFixed(2),
                payment_status,
                shipping_status: group.shipping_statuses.size > 0 ? shipping_status : null
            };
        });

        formattedOrders.sort((a,b) => new Date(b.orderDate) - new Date(a.orderDate));

        res.send({
            customerName: customer.name || '',
            orders: formattedOrders
        });
    } catch (error) {
        console.error(`Error in getOrderStatus for PSID ${psid}:`, error);
        res.status(500).send({ message: "Error retrieving order status." });
    }
};

