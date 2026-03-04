'use strict';

const axios = require('axios');
const db = require("../models");
const Customer = db.Customer;
const Order = db.Order;
const OrderItem = db.OrderItem;
const GroupOrder = db.GroupOrder;
const Product = db.Product;
const sequelize = db.sequelize;
const { refundCreditForCancelledOrder } = require("./storeCredit.controller");
const { callSendAPI, setUserPersistentMenu } = require("../utils/facebookApi");
const { Op } = require("sequelize");

// Access token and verify token from .env file
const VERIFY_TOKEN = process.env.FACEBOOK_VERIFY_TOKEN;

// --- Webhook Verification ---
exports.verifyWebhook = (req, res) => {
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];

    console.log(`[WEBHOOK] Verification attempt — mode: ${mode}, token: ${token ? token.substring(0, 8) + '...' : 'MISSING'}`);

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('[WEBHOOK] ✅ Webhook verified successfully!');
            res.status(200).send(challenge);
        } else {
            console.error('[WEBHOOK] ❌ Verification failed: Token mismatch. Received:', token);
            res.sendStatus(403);
        }
    } else {
        console.error('[WEBHOOK] ❌ Verification failed: Missing mode or token.');
        res.sendStatus(400);
    }
};

// --- Event Handling Entry Point ---
exports.handleEvent = async (req, res) => {
    let body = req.body;
    // console.log('[WEBHOOK] 📨 Incoming webhook event:', JSON.stringify(body, null, 2));

    if (body.object === 'page') {
        // Process each entry in the body
        for (const entry of body.entry) {
            // entry.messaging is an array of messaging events
            for (const webhook_event of entry.messaging) {
                try {
                    let sender_psid = webhook_event.sender ? webhook_event.sender.id : null;
                    if (!sender_psid) {
                        console.error('[WEBHOOK] ❌ Missing sender PSID in webhook event:', JSON.stringify(webhook_event));
                        continue;
                    }

                    // console.log(`[WEBHOOK] 🎯 Processing event for PSID ${sender_psid}...`);

                    if (webhook_event.referral) {
                        console.log(`[WEBHOOK] → Referral event from PSID: ${sender_psid} | Ref: ${webhook_event.referral.ref}`);
                        let { customer, created } = await getCustomerAndState(sender_psid);
                        if (created) {
                            await setUserPersistentMenu(sender_psid);
                            await startOrderFlow(sender_psid, customer);
                        }
                    } else if (webhook_event.message) {
                        const msgText = webhook_event.message.text || '[non-text message]';
                        console.log(`[WEBHOOK] → Message event from PSID: ${sender_psid} | Text: "${msgText}"`);
                        await handleMessage(sender_psid, webhook_event.message);
                    } else if (webhook_event.postback) {
                        console.log(`[WEBHOOK] → Postback event from PSID: ${sender_psid} | Payload: "${webhook_event.postback.payload}"`);
                        await handlePostback(sender_psid, webhook_event.postback);
                    } else if (webhook_event.read) {
                        // console.log(`[WEBHOOK] → Read receipt from PSID: ${sender_psid}`);
                    } else {
                        console.warn('[WEBHOOK] ⚠️ Unhandled webhook event type:', JSON.stringify(webhook_event));
                    }
                } catch (error) {
                    console.error(`[WEBHOOK] ❌ Error processing event from PSID ${webhook_event.sender?.id}:`, error);
                }
            }
        }
        res.status(200).send('EVENT_RECEIVED');
    } else {
        console.warn(`[WEBHOOK] ⚠️ Received event for unexpected object type: '${body.object}'`);
        res.sendStatus(404);
    }
};

// --- Helper function to get or create customer and their state ---
async function getCustomerAndState(sender_psid) {
    console.log(`[CUSTOMER] Attempting findOrCreate for PSID: ${sender_psid}`);
    try {
        let [customer, created] = await Customer.findOrCreate({
            where: { facebook_psid: sender_psid },
            defaults: {
                facebook_psid: sender_psid,
                conversation_state: 'INITIAL',
                conversation_data: {}
            }
        });

        console.log(`[CUSTOMER] Result for PSID ${sender_psid}: Created=${created}, ID=${customer?.id}`);

        if (!customer.conversation_data) {
            customer.conversation_data = {};
        }
        return { customer, created };
    } catch (error) {
        console.error(`[CUSTOMER] ❌ Error in getCustomerAndState for PSID ${sender_psid}:`, error);
        throw error;
    }
}
exports.getCustomerAndState = getCustomerAndState; // Exported

// --- Helper function to update customer state ---
async function updateCustomerState(customer, newState, newData = null) {
    customer.conversation_state = newState;
    if (newData !== null) {
        customer.conversation_data = newData;
    }
    await customer.save();
}
exports.updateCustomerState = updateCustomerState; // Exported

// --- Helper function to clear customer state ---
async function clearCustomerState(customer, transaction = null) {
    customer.conversation_state = 'INITIAL';
    customer.conversation_data = {};
    await customer.save({ transaction });
}
exports.clearCustomerState = clearCustomerState; // Exported




async function proceedToOrderSelection(sender_psid, customer, groupOrderId) {
    let currentData = customer.conversation_data || {};
    currentData.groupOrderId = groupOrderId;
    currentData.customerId = customer.id;

    // Check for an existing, unpaid order
    const existingOrder = await Order.findOne({
        where: {
            customer_id: customer.id,
            group_order_id: groupOrderId,
            payment_status: { [Op.notIn]: ['Paid', 'Cancelled', 'Payment Claimed'] }
        }
    });

    let responseText;
    if (existingOrder) {
        currentData.orderId = existingOrder.id;
        responseText = "Tap “Shop Now” below to continue your order. You can also open the menu in the bottom right for more options.";
    } else {
        responseText = "Tap “Shop Now” below to start your order. You can also open the menu in the bottom right for more options.";
    }

    // Load cart from persistent storage and validate
    let cartItems = customer.persistent_cart || {};
    const productIds = Object.keys(cartItems);

    if (productIds.length > 0) {
        // Prune stale items
        const activeProducts = await Product.findAll({
            where: { id: { [Op.in]: productIds }, is_active: true, '$brand.isActive$': true },
            include: [{ model: db.Brand, as: 'brand', attributes: ['isActive'] }]
        });

        const activeProductIds = new Set(activeProducts.map(p => p.id.toString()));
        let pruned = false;
        const newCart = {};

        for (const pid of productIds) {
            if (activeProductIds.has(pid.toString())) {
                newCart[pid] = cartItems[pid];
            } else {
                pruned = true;
            }
        }

        if (pruned) {
            customer.persistent_cart = newCart;
            await customer.save();
            await callSendAPI(sender_psid, { text: "Note: Some items were removed from your cart because they are no longer available." });
        }
    }

    await updateCustomerState(customer, "ORDERING_SELECT_PRODUCT", currentData);
    await callSendAPI(sender_psid, { text: responseText });
    await sendProductSelectionWebviewButton(sender_psid, groupOrderId);
}

async function startOrderFlow(sender_psid, customer) {
    let response;
    let currentData = customer.conversation_data || {};
    try {
        const activeGroupOrders = await GroupOrder.findAll({ where: { status: "Active" } });
        if (activeGroupOrders.length === 0) {
            response = { text: "Sorry, there's no active group order right now." };
            await callSendAPI(sender_psid, response);
        } else if (activeGroupOrders.length > 1) {
            currentData = {
                customerId: customer.id,
                availableGroupOrders: activeGroupOrders.map(go => ({ id: go.id, name: go.name }))
            };

            let groupOrderOptions = activeGroupOrders.map(go => ({
                content_type: "text",
                title: go.name,
                payload: `SELECT_GROUP_ORDER:${go.id}`
            }));

            let messageText = "There are multiple active group orders. Please select one by typing its name or ID, or by using the buttons below:\n\n";
            activeGroupOrders.forEach(go => {
                messageText += `- ${go.name} (ID: ${go.id})\n`;
            });

            response = {
                text: messageText,
                quick_replies: groupOrderOptions
            };
            await updateCustomerState(customer, "AWAITING_GROUP_ORDER_SELECTION", currentData);
            await callSendAPI(sender_psid, response);
        } else {
            // If only one active group order, proceed directly
            await proceedToOrderSelection(sender_psid, customer, activeGroupOrders[0].id);
        }
    } catch (error) {
        console.error("Error starting order process:", error);
        response = { text: "Sorry, something went wrong while starting your order." };
        await callSendAPI(sender_psid, response);
    }
}




// --- Message Handler ---
async function handleMessage(sender_psid, received_message) {
    if (received_message.is_echo) {
        // console.log(`[WEBHOOK] ↩️ Echo message from PSID ${sender_psid}, ignoring.`);
        return;
    }

    // Ensure customer exists in DB first (this triggers the welcome/menu for new users)
    let { customer, created } = await getCustomerAndState(sender_psid);
    let currentState = customer.conversation_state || 'INITIAL';
    let currentData = customer.conversation_data;

    // Greeting for brand new users who skip GET_STARTED
    if (created) {
        await setUserPersistentMenu(sender_psid);
        await startOrderFlow(sender_psid, customer);
        // We continue processing the actual message they sent too
    }

    let response;
    const messageText = received_message.text ? received_message.text.trim() : '';
    const lowerCaseMessageText = messageText.toLowerCase();
    const quickReplyPayload = received_message.quick_reply?.payload;

    console.log(`[WEBHOOK] 💬 Processing message from PSID ${sender_psid} | State: "${currentState}" | Text: "${messageText}"${quickReplyPayload ? ` | Quick Reply: "${quickReplyPayload}"` : ''}`);

    // Handle non-text messages
    if (!received_message.text) {
        if (received_message.attachments) {
            console.log(`[WEBHOOK] 📎 Attachment received from PSID ${sender_psid}`);
            const response = { text: "Thanks for the attachment, I'll review this manually! If you want to order, please use the \"Shop Now\" button in the menu in the bottom right." };
            callSendAPI(sender_psid, response);
        } else {
            console.log(`[WEBHOOK] ⚠️ Unknown message type from PSID ${sender_psid}:`, JSON.stringify(received_message));
            const response = { "text": "Sorry, I didn't understand that. You can find all options in the menu in the bottom right!" };
            callSendAPI(sender_psid, response);
        }
        return; // Stop further processing
    }


    // Handle Regular Text Messages
    if (messageText) {
        // Every text message triggers the shop card flow
        console.log(`[WEBHOOK] Text received from PSID: ${sender_psid}. Sending shop card.`);
        await startOrderFlow(sender_psid, customer);
        return;
    }
}

// --- Postback Handler ---
async function handlePostback(sender_psid, received_postback) {
    let response;
    const payload = received_postback.payload;

    let { customer } = await getCustomerAndState(sender_psid);
    let currentState = customer.conversation_state || 'INITIAL';

    // Welcome new users who click the Get Started button
    if (payload === 'GET_STARTED') {
        console.log(`[WEBHOOK] 🎉 GET_STARTED postback from PSID: ${sender_psid}`);
        await setUserPersistentMenu(sender_psid);
        await startOrderFlow(sender_psid, customer);
        return;
    }

    // Persistent Menu Actions
    if (payload === 'START_ORDER') {
        await startOrderFlow(sender_psid, customer);
        return;
    } else if (payload === 'VIEW_CART') {
        await displayCart(sender_psid, customer);
        return;
    } else if (payload === 'SET_NOTIF_GROUP_ORDER_ENABLED') {
        customer.disable_grouporder_notification = false;
        await customer.save();
        await setUserPersistentMenu(sender_psid, customer);
        response = { text: "Group order notifications enabled! You'll receive a message when new group orders open." };
    } else if (payload === 'SET_NOTIF_GROUP_ORDER_DISABLED') {
        customer.disable_grouporder_notification = true;
        await customer.save();
        await setUserPersistentMenu(sender_psid, customer);
        response = { text: "Group order notifications disabled. You can re-enable them anytime from the same menu." };
    }
    // Fallback
    else {
        console.warn(`Unhandled postback payload: ${payload} in state: ${currentState}`);
        response = { "text": "Sorry, I didn't understand that action. Use the menu in the bottom right to shop!" };
    }

    if (response) { callSendAPI(sender_psid, response); }
}

async function displayCart(sender_psid, customer) {
    const cartItems = customer.persistent_cart || {};
    if (Object.keys(cartItems).length === 0) {
        await callSendAPI(sender_psid, { text: "Your cart is empty." });
        return;
    }

    let cartText = "Your current cart:\n";
    let subtotal = 0;

    const productIds = Object.keys(cartItems);
    const products = await Product.findAll({ where: { id: { [Op.in]: productIds } } });
    const productMap = products.reduce((map, product) => {
        map[product.id] = product;
        return map;
    }, {});

    for (const productId in cartItems) {
        const product = productMap[productId];
        if (product) {
            const itemData = cartItems[productId];
            const quantity = typeof itemData === 'object' && itemData !== null ? itemData.quantity : itemData;
            const price = product.price;
            const name = product.name;

            cartText += `- ${name} (Qty: ${quantity}): $${(price * quantity).toFixed(2)}\n`;
            subtotal += price * quantity;
        }
    }

    // Attempt to calculate total with shipping
    let shippingCost = 5.50;
    try {
        const activeGroupOrder = await GroupOrder.findOne({ where: { status: 'Active' } });
        if (activeGroupOrder) {
            const existingPaidOrders = await Order.findAll({
                where: {
                    customer_id: customer.id,
                    group_order_id: activeGroupOrder.id,
                    payment_status: { [Op.in]: ['Payment Claimed', 'Paid'] }
                }
            });
            if (existingPaidOrders.length > 0) shippingCost = 0.00;
        }
    } catch (e) { console.error("Error calculating shipping in displayCart:", e); }

    const totalAmount = subtotal + shippingCost;

    cartText += `\nSubtotal: $${subtotal.toFixed(2)}\nShipping: $${shippingCost.toFixed(2)}\nTotal: $${totalAmount.toFixed(2)}`;
    await callSendAPI(sender_psid, { text: cartText });
}

async function handlePaymentVerified(sender_psid, orderId, customer) {
    try {
        const order = await Order.findByPk(orderId);
        if (!order) {
            console.error(`Order ${orderId} not found.`);
            await callSendAPI(sender_psid, { text: "Sorry, couldn't find that order." });
            return;
        }

        if (order.payment_status !== 'Paid') {
            console.warn(`Order ${orderId} payment status is not 'Paid'.`);
            await callSendAPI(sender_psid, { text: "Sorry, payment verification is still pending." });
            return;
        }

        const response = { text: "Great news! Your payment has been verified. Thanks for your order! If you have any questions, please message me here https://m.me/naomi.seijo.2025" };
        await callSendAPI(sender_psid, response, 'POST_PURCHASE_UPDATE');
    } catch (error) {
        console.error(`Error handling payment verified for order ${orderId}:`, error);
        await callSendAPI(sender_psid, { text: "Sorry, there was an error verifying your payment." });
    }
}

// --- Send Product Selection Webview Button ---
// Renamed from sendProductSelection
async function sendProductSelectionWebviewButton(sender_psid, groupOrderId) {
    const frontendBaseUrl = process.env.FRONTEND_URL; // Read from .env
    if (!frontendBaseUrl) {
        console.error("FRONTEND_URL is not set in the .env file. Cannot generate webview URL.");
        await callSendAPI(sender_psid, { text: "Sorry, cannot load the item selection page right now due to a configuration issue." });
        return;
    }
    const webviewUrl = `${frontendBaseUrl}/messenger-order?psid=${encodeURIComponent(sender_psid)}`;

    if (!groupOrderId) {
        console.error(`Cannot send webview button for user ${sender_psid}, groupOrderId is missing from state.`);
        await callSendAPI(sender_psid, { text: "Sorry, something went wrong. Cannot load products right now." });
        return;
    }

    let featuredImageUrl = "https://via.placeholder.com/300x200?text=Select+Items"; // Default

    try {
        const groupOrder = await GroupOrder.findByPk(groupOrderId);
        if (!groupOrder || groupOrder.status !== 'Active') {
            await callSendAPI(sender_psid, { text: "Sorry, this group order is no longer active." });
            await clearCustomerState(await getCustomerAndState(sender_psid));
            return;
        }

        // --- Logic to get the first featured product's image ---
        const featuredCollections = await db.Collection.findAll({
            where: { is_featured: true, isActive: true, '$brand.isActive$': true },
            include: [
                { model: db.Product, as: 'products', where: { is_active: true }, required: false },
                { model: db.Brand, as: 'brand', attributes: ['name', 'isActive'], where: { isActive: true } }
            ],
            order: [['displayOrder', 'ASC']]
        });

        const firstCollectionWithProducts = featuredCollections.find(c => c.products && c.products.length > 0);

        if (firstCollectionWithProducts) {
            const firstProduct = firstCollectionWithProducts.products[0];
            if (firstProduct && firstProduct.images && firstProduct.images.length > 0) {
                featuredImageUrl = firstProduct.images[0].startsWith('http') ? firstProduct.images[0] : `${process.env.BACKEND_URL}/${firstProduct.images[0]}`;
            }
        } else {
            // Fallback to the first "other" featured item if no collections have products
            const otherFeaturedItem = await Product.findOne({
                where: { is_featured: true, is_active: true, '$brand.isActive$': true },
                include: [{ model: db.Brand, as: 'brand', where: { isActive: true } }],
                order: [['createdAt', 'DESC']] // Or some other deterministic order
            });
            if (otherFeaturedItem && otherFeaturedItem.images && otherFeaturedItem.images.length > 0) {
                featuredImageUrl = otherFeaturedItem.images[0].startsWith('http') ? otherFeaturedItem.images[0] : `${process.env.BACKEND_URL}/${otherFeaturedItem.images[0]}`;
            }
        }
        // --- End of logic ---

    } catch (error) {
        console.error("Error checking group order status or fetching featured image:", error);
        await callSendAPI(sender_psid, { text: "Sorry, something went wrong before loading products." });
        return;
    }

    const response = {
        attachment: {
            type: "template",
            payload: {
                template_type: "generic",
                elements: [
                    {
                        title: "Start Your Order",
                        image_url: featuredImageUrl,
                        subtitle: "Click the button below to browse products and add items to your order.",
                        default_action: {
                            type: "web_url",
                            url: webviewUrl,
                            webview_height_ratio: "full",
                            messenger_extensions: false
                        },
                        buttons: [
                            {
                                type: "web_url",
                                url: webviewUrl,
                                title: "Shop Now",
                                webview_height_ratio: "full",
                                messenger_extensions: false
                            }
                        ]
                    }
                ]
            }
        }
    };
    await callSendAPI(sender_psid, response);
}


async function sendOrderSummaryMessage(psid, orderId) {
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
        return;
    }

    let summaryText = "Here is your final order summary:\n\n";
    order.orderItems.forEach(item => {
        summaryText += `- ${item.orderProduct.name} (Qty: ${item.quantity}): $${(item.quantity * item.price_at_order_time).toFixed(2)}\n`;
    });

    const subtotal = order.orderItems.reduce((sum, item) => sum + (item.quantity * item.price_at_order_time), 0);

    summaryText += `\nSubtotal: $${subtotal.toFixed(2)}`;
    summaryText += `\nShipping: $${order.shipping_cost.toFixed(2)}`;
    if (order.applied_credit > 0) {
        summaryText += `\nCredit Applied: -$${order.applied_credit.toFixed(2)}`;
    }
    summaryText += `\nTotal: $${order.total_amount.toFixed(2)}`;

    await callSendAPI(psid, { text: summaryText });
}

// --- Send API Wrapper ---
exports.handlePaymentVerified = handlePaymentVerified;
exports.sendProductSelectionWebviewButton = sendProductSelectionWebviewButton; // Exported
exports.sendOrderSummaryMessage = sendOrderSummaryMessage;
