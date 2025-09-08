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
const { callSendAPI } = require("../utils/facebookApi");
const { Op } = require("sequelize");

// Access token and verify token from .env file
const VERIFY_TOKEN = process.env.FACEBOOK_VERIFY_TOKEN;

// --- Webhook Verification ---
exports.verifyWebhook = (req, res) => {
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            res.status(200).send(challenge);
        } else {
            console.error('Webhook verification failed: Invalid token.');
            res.sendStatus(403);
        }
    } else {
         console.error('Webhook verification failed: Missing mode or token.');
         res.sendStatus(400);
    }
};

// --- Event Handling Entry Point ---
exports.handleEvent = (req, res) => {
    let body = req.body;
    if (body.object === 'page') {
        body.entry.forEach(function(entry) {
            let webhook_event = entry.messaging[0];

            let sender_psid = webhook_event.sender.id;
            if (!sender_psid) {
                console.error("Missing sender PSID in webhook event.");
                return;
            }

            if (webhook_event.referral) {
                handleReferral(sender_psid, webhook_event.referral);
            } else if (webhook_event.message) {
                handleMessage(sender_psid, webhook_event.message);
            } else if (webhook_event.postback) {
                handlePostback(sender_psid, webhook_event.postback);
            } else if (webhook_event.read) {
                 // console.log('Event Type: Read Receipt');
            } else {
                console.warn("Received unhandled webhook event type:", webhook_event);
            }
        });
        res.status(200).send('EVENT_RECEIVED');
    } else {
        console.warn("Received webhook event for object other than 'page':", body.object);
        res.sendStatus(404);
    }
};

// --- Helper function to get or create customer and their state ---
async function getCustomerAndState(sender_psid) {
    let [customer, created] = await Customer.findOrCreate({
        where: { facebook_psid: sender_psid },
        defaults: {
            facebook_psid: sender_psid,
            conversation_state: 'INITIAL',
            conversation_data: {}
        }
    });
    if (!customer.conversation_data) {
        customer.conversation_data = {};
    }
    return customer;
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
                currentOrderItems: customer.conversation_data?.currentOrderItems || {},
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
            currentData = { customerId: customer.id, groupOrderId: activeGroupOrders[0].id, currentOrderItems: {} };
            await updateCustomerState(customer, "ORDERING_SELECT_PRODUCT", currentData);
            response = { text: "Use the button below to start your order. If you get stuck, type `!help`" };
            await callSendAPI(sender_psid, response);
            await sendProductSelectionWebviewButton(sender_psid, currentData.groupOrderId);
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
        return;
    }

    let response;
    const messageText = received_message.text?.trim();
    const lowerCaseMessageText = messageText?.toLowerCase();
    const quickReplyPayload = received_message.quick_reply?.payload;

    let customer = await getCustomerAndState(sender_psid);
    let currentState = customer.conversation_state || 'INITIAL';
    let currentData = customer.conversation_data;

    // Handle Text Quick Replies
    if (quickReplyPayload) {
        if (currentState === "ORDERING_CHECK_ADDRESS") {
            if (quickReplyPayload === "CONFIRM_ADDRESS_YES") {
                await updateCustomerState(customer, "ORDERING_SELECT_PRODUCT");
                // response = { text: "Great! Please use the button below to select your items." };
                await callSendAPI(sender_psid, response);
                await sendProductSelectionWebviewButton(sender_psid, currentData.groupOrderId);
                return;
            } else if (quickReplyPayload === "CONFIRM_ADDRESS_NO") {
                await updateCustomerState(customer, "ORDERING_AWAITING_ADDRESS");
                response = { text: "Okay, please provide your updated details in this format (separate each part with a comma):\nFull Name, Email, Street Address, City, State, Zip" };
                await callSendAPI(sender_psid, response);
                return;
            }
        } else if (currentState === "AWAITING_ORDER_CONFIRMATION") {
            if (quickReplyPayload.startsWith("CONFIRM_ORDER:")) {
                await handleConfirmOrder(sender_psid, quickReplyPayload, customer);
                return;
            } else if (quickReplyPayload.startsWith("EDIT_ORDER:")) {
                await handleEditOrder(sender_psid, quickReplyPayload, customer);
                return;
            } else if (quickReplyPayload.startsWith("CANCEL_ORDER:")) {
                await handleCancelOrder(sender_psid, quickReplyPayload, customer);
                return;
            }
        } else if (currentState === "AWAITING_PAYMENT_CONFIRMATION") {
            if (quickReplyPayload.startsWith("MARK_PAID_CLAIMED:")) {
                await handleMarkPaidClaimed(sender_psid, quickReplyPayload, customer);
                return;
            }
        } else if (quickReplyPayload.startsWith("MARK_PAID_CLAIMED:")) {
            await handleMarkPaidClaimed(sender_psid, payload, customer);
            return;
        } else {
            console.warn(`Unhandled text quick reply payload: ${quickReplyPayload}`);
        }
    }

    // Handle Regular Text Messages
    if (messageText) {
        if (lowerCaseMessageText === "restart") {
            const t = await sequelize.transaction();
            try {
                if (currentData.orderId) {
                    await refundCreditForCancelledOrder(currentData.orderId, t);
                    await Order.update({ payment_status: 'Cancelled' }, { where: { id: currentData.orderId, customer_id: customer.id }, transaction: t });
                }
                await t.commit();
            } catch (error) {
                await t.rollback();
                console.error("Error during restart transaction:", error);
            }
            await clearCustomerState(customer);
            // After clearing state, immediately start the order flow
            await startOrderFlow(sender_psid, customer);
            return;
        }

        if (lowerCaseMessageText === "help" || lowerCaseMessageText === "!help") {
            let helpText = "Here are the available commands:\n\n";
            switch (currentState) {
                case "ORDERING_AWAITING_ADDRESS":
                    helpText += "- Provide your details in the format: Full Name, Email, Street Address, City, State, Zip\n";
                    helpText += "- restart: Start over\n";
                    break;
                case "ORDERING_CHECK_ADDRESS":
                    helpText += "- yes - Confirm your address\n";
                    helpText += "- no - Update your address\n";
                    helpText += "- restart: Start over\n";
                    break;
                case "ORDERING_SELECT_PRODUCT":
                    helpText += "- Use the 'Select Items' button to build your order.\n";
                    helpText += "- cart: View your current cart\n";
                    helpText += "- restart: Start over\n";
                    break;
                case "AWAITING_ORDER_CONFIRMATION":
                    helpText += "- confirm: Confirm your order\n";
                    helpText += "- edit: Edit your order\n";
                    helpText += "- cancel: Cancel your order\n";
                    helpText += "- cart: View your current cart\n";
                    helpText += "- restart: Start over\n";
                    break;
                case "AWAITING_PAYMENT_CONFIRMATION":
                    helpText += "- paid: Confirm your payment\n";
                    helpText += "- edit: Edit your order\n";
                    helpText += "- cart: View your current cart\n";
                    helpText += "- restart: Start over\n";
                    break;
                case "AWAITING_GROUP_ORDER_SELECTION":
                    helpText += "- Select a group order by typing its name or ID, or by using the quick replies\n";
                    helpText += "- restart: Start over\n";
                    break;
                case "INITIAL":
                default:
                    helpText += "- order: Start a new order\n";
                    break;
            }
            response = { text: helpText };
            callSendAPI(sender_psid, response);
            return;
        }
        // Start Order
        else if (lowerCaseMessageText === "order" && currentState === "INITIAL") {
            await startOrderFlow(sender_psid, customer);
            return;
        } else if (currentState === "AWAITING_GROUP_ORDER_SELECTION") {
             const selectedGroupOrder = currentData.availableGroupOrders.find(go => (
                go.name.toLowerCase() === lowerCaseMessageText || String(go.id) === messageText
            ));

            if (selectedGroupOrder) {
                currentData.groupOrderId = selectedGroupOrder.id;
                await updateCustomerState(customer, "ORDERING_SELECT_PRODUCT", currentData);
                response = { text: "Use the button below to start your order. If you get stuck, type `!help`" };
                await callSendAPI(sender_psid, response);
                await sendProductSelectionWebviewButton(sender_psid, currentData.groupOrderId);
                return;
            } else {
                response = { text: "Sorry, I couldn't find a group order matching that name or ID. Please try again, or type 'help' for available commands." };
                 callSendAPI(sender_psid, response);
                 return;
            }
        }
        // Handle Address/Info Input
        else if (currentState === "ORDERING_AWAITING_ADDRESS") {
            const parts = messageText.split(",").map(p => p.trim());
            if (parts.length === 6) {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                if (!emailRegex.test(parts[1])) {
                    response = { text: "Hmm, that doesn't look like a valid email address. Please try again in the format:\nFull Name, Email, Street Address, City, State, Zip" };
                } else {
                    try {
                        customer.name = parts[0]; customer.email = parts[1]; customer.street_address = parts[2];
                        customer.city = parts[3]; customer.state = parts[4]; customer.zip = parts[5];
                        customer.is_international = false; customer.international_address_block = null;
                        await updateCustomerState(customer, "ORDERING_SELECT_PRODUCT");
                        response = { text: "Thanks! Your details are saved. Please use the button below to select your items." };
                        await callSendAPI(sender_psid, response);
                        await sendProductSelectionWebviewButton(sender_psid, currentData.groupOrderId);
                        return;
                    } catch (error) {
                        console.error("Error saving customer details:", error);
                        response = { text: "Sorry, there was an error saving your details." };
                    }
                }
            } else {
                response = { text: "Hmm, that doesn't look like the right format (6 parts separated by commas). Please use:\nFull Name, Email, Street Address, City, State, Zip" };
            }
        }
        else if (currentState === "ORDERING_CHECK_ADDRESS"){
            if (lowerCaseMessageText === "yes") {
                await updateCustomerState(customer, "ORDERING_SELECT_PRODUCT");
                response = { text: "Great! Please use the button below to select your items." };
                await callSendAPI(sender_psid, response);
                await sendProductSelectionWebviewButton(sender_psid, currentData.groupOrderId);
                return;
            } else if (lowerCaseMessageText === "no") {
                await updateCustomerState(customer, "ORDERING_AWAITING_ADDRESS");
                response = { text: "Okay, please provide your updated details in this format (separate each part with a comma):\nFull Name, Email, Street Address, City, State, Zip" };
                await callSendAPI(sender_psid, response);
                return;
            }
        }



        else if (lowerCaseMessageText === "cart") {
            await displayCart(sender_psid, currentData);
            return;
        }
        // Handle 'help' command

        // Default / Fallback
        else if (currentState === "AWAITING_ORDER_CONFIRMATION") {
            if (lowerCaseMessageText === "confirm") {
                await handleConfirmOrder(sender_psid, `CONFIRM_ORDER:${currentData.orderId}`, customer);
                return;
            } else if (lowerCaseMessageText === "edit") {
                await handleEditOrder(sender_psid, `EDIT_ORDER:${currentData.orderId}`, customer);
                return;
            } else if (lowerCaseMessageText === "cancel") {
                await handleCancelOrder(sender_psid, `CANCEL_ORDER:${currentData.orderId}`, customer);
                return;
            } else {
                response = { text: "Please type 'confirm', 'edit', or 'cancel' for your order." };
            }
        }

        else if (currentState === "AWAITING_PAYMENT_CONFIRMATION") {
            if (lowerCaseMessageText === "edit") {
                await handleEditOrder(sender_psid, `EDIT_ORDER:${currentData.orderId}`, customer);
                return;
            } else if (lowerCaseMessageText === "paid") {
                await handleMarkPaidClaimed(sender_psid, `MARK_PAID_CLAIMED:${currentData.orderId}`, customer);
                return;
            } else {
                response = { text: "Please confirm your payment by typing 'paid', edit your order by typing 'edit', or check your cart by typing 'cart'." };
            }
    }
    // Handle Non-Text Messages
    else if (received_message.attachments) {
        response = { text: "Thanks for the attachment! If you want to order, please type 'order'." };
    }
    // Fallback
    else {
         console.warn(`Handling unknown message type from ${sender_psid}`);
         response = { "text": "Sorry, I didn't understand that. If you get stuck, type `!help`" }
     }

     // Send the response message if one was generated
     if (response) {
        callSendAPI(sender_psid, response);
     }
 }
}

// --- Postback Handler ---
async function handlePostback(sender_psid, received_postback) {
    let response;
    const payload = received_postback.payload;
    const referral = received_postback.referral; // Check for referral for new users

    // Handle m.me link referral for new users
    if (referral && referral.ref && referral.ref.startsWith('go_')) {
        console.warn(`Referral received on postback, but this flow is deprecated. Ref: ${referral.ref}`);
        // The new flow uses ?text=order, so this part is unlikely to be hit.
        // You could optionally trigger the 'order' flow here as a fallback.
    }

    let customer = await getCustomerAndState(sender_psid);
    let currentState = customer.conversation_state || 'INITIAL';
    let currentData = customer.conversation_data || {};

    // Add Product - This path should ideally not be used anymore with the webview
    if (payload.startsWith('ADD_PRODUCT:') && currentState === 'ORDERING_SELECT_PRODUCT') {
        console.warn("ADD_PRODUCT postback received, webview flow expected.");
        response = { text: "Please use the 'Select Items' button to manage your order." };
        await callSendAPI(sender_psid, response);
        await sendProductSelectionWebviewButton(sender_psid, currentData.groupOrderId);
        return;
    }
    // Mark Paid Claimed
    else if (payload.startsWith('MARK_PAID_CLAIMED:')) {
        await handleMarkPaidClaimed(sender_psid, payload, customer);
        return;
    }
    // Fallback
    else {
        console.warn(`Unhandled postback payload: ${payload} in state: ${currentState}`);
        response = { "text": `Received: ${payload}` };
    }

    if (response) { callSendAPI(sender_psid, response); }
}

async function displayCart(sender_psid, currentData) {
    const cartItems = currentData.currentOrderItems || {};
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

    const existingPaidOrders = await Order.findAll({
        where: {
            customer_id: currentData.customerId,
            group_order_id: currentData.groupOrderId,
            payment_status: { [Op.in]: ['Payment Claimed', 'Paid'] }
        }
    });

    const shippingCost = existingPaidOrders.length > 0 ? 0.00 : 5.00;
    const totalAmount = subtotal + shippingCost;

    cartText += `\nSubtotal: $${subtotal.toFixed(2)}\nShipping: $${shippingCost.toFixed(2)}\nTotal: $${totalAmount.toFixed(2)}`;
    await callSendAPI(sender_psid, { text: cartText });
}

// --- Specific Handler Functions ---

async function handleConfirmOrder(sender_psid, payload, customer) {
    const orderId = parseInt(payload.split(':')[1]);
    let currentData = customer.conversation_data || {};

    if (!isNaN(orderId) && orderId === currentData.orderId) {
        // This function is likely deprecated by the new webview flow,
        // but we'll keep it for now and just confirm the order.
        // The webview should now handle the payment flow.
        await updateCustomerState(customer, 'AWAITING_PAYMENT_CONFIRMATION', currentData);
        await callSendAPI(sender_psid, { text: "Awesome! Please send payment via friends and family to one of these two options:\n\nVenmo (preferred): @naomiseijo\n(Last 4 digits: 5176 - Add this if needed)\n\nor\nPayPal: seijon386@yahoo.com" });
    } else {
        console.warn(`Order confirmation payload mismatch/invalid. Payload: ${payload}, State Order ID: ${currentData.orderId}`);
        await callSendAPI(sender_psid, { text: "Sorry, there was an issue confirming your order." });
    }
}

async function handleEditOrder(sender_psid, payload, customer) {
     const orderId = parseInt(payload.split(':')[1]);
     let currentData = customer.conversation_data || {};

     if (!isNaN(orderId)) {
         currentData.orderId = orderId;
         await updateCustomerState(customer, 'ORDERING_SELECT_PRODUCT', currentData);
         await sendProductSelectionWebviewButton(sender_psid, currentData.groupOrderId);
     } else {
         console.warn(`Edit order payload mismatch/invalid. Payload: ${payload}, State Order ID: ${currentData.orderId}`);
         await callSendAPI(sender_psid, { text: "Sorry, there was an issue editing your order." });
     }
 }

async function handleCancelOrder(sender_psid, payload, customer) {
    let response;
    const orderId = parseInt(payload.split(':')[1]);
    let currentData = customer.conversation_data || {};

    if (!isNaN(orderId) && orderId === currentData.orderId) {
        const t = await sequelize.transaction();
        try {
            const customerIdForCancel = currentData?.customerId;
            if (!customerIdForCancel) {
                console.error(`Cannot cancel order ${orderId}, customer ID missing.`);
                response = { text: "Sorry, error cancelling." };
            } else {
                await refundCreditForCancelledOrder(orderId, t);
                const [num] = await Order.update({ payment_status: 'Cancelled' }, { where: { id: orderId, customer_id: customerIdForCancel }, transaction: t });
                response = (num === 1) ? { text: "Okay, your order has been cancelled." } : { text: "Sorry, couldn't find order to cancel." };
            }
            await t.commit();
            await clearCustomerState(customer);
            return;
        } catch (error) {
            await t.rollback();
            console.error(`Error cancelling order ${orderId}:`, error);
            response = { text: "Sorry, error cancelling." };
        }
    } else {
        response = { text: "Sorry, issue cancelling your order." };
    }
    callSendAPI(sender_psid, response);
}

async function handleMarkPaidClaimed(sender_psid, payload, customer) {
    let response;
    const orderId = parseInt(payload.split(':')[1]);
    if (!isNaN(orderId)) {
        const t = await sequelize.transaction();
        try {
            if (!customer) {
                console.error(`Cannot mark order ${orderId} paid, customer object invalid.`);
                response = { text: "Sorry, error finding your record." };
            } else {
                const { appliedCredit, newTotal } = await applyCreditToOrder(orderId, t);
                const [num] = await Order.update({ payment_status: 'Payment Claimed' }, { where: { id: orderId, customer_id: customer.id }, transaction: t });

                if (appliedCredit > 0) {
                    const message = {
                        text: `We've applied a credit of $${appliedCredit.toFixed(2)} to your order. Your new total is $${newTotal.toFixed(2)}.`
                    };
                    await callSendAPI(sender_psid, message);
                }

                response = (num === 1) ? { text: "Thanks for confirming! We'll verify payment soon. Be sure to like this page for information on future group orders! https://www.facebook.com/naomisgrouporders" } : { text: "Sorry, couldn't find that order." };
                await callSendAPI(sender_psid, response);
                await sendOrderSummaryMessage(sender_psid, orderId);
                await clearCustomerState(customer, t);
                await t.commit();
                return;
            }
        } catch (error) {
            await t.rollback();
            console.error(`Error marking order ${orderId} paid:`, error);
            response = { text: "Sorry, error updating payment status." };
        }
    } else {
        response = { text: "Sorry, couldn't identify which order." };
    }
    callSendAPI(sender_psid, response);
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
                                title: "Select Items",
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
