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
    console.log('[WEBHOOK] 📨 Incoming webhook event:', JSON.stringify(body, null, 2));

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

                    console.log(`[WEBHOOK] 🎯 Processing event for PSID ${sender_psid}...`);

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
                        console.log(`[WEBHOOK] → Read receipt from PSID: ${sender_psid}`);
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

// --- Helper functions for destash state ---
async function updateDestashState(customer, newState, newData = null) {
    customer.destash_conversation_state = newState;
    if (newData !== null) {
        customer.destash_conversation_data = newData;
    }
    await customer.save();
}

async function clearDestashState(customer) {
    customer.destash_conversation_state = null;
    customer.destash_conversation_data = {};
    await customer.save();
}


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
        responseText = "You have a pending order. Use the button below to view or edit it, or use the menu in the bottom right for more options.";
    } else {
        responseText = "Use the button below to start your order. You can also find your cart and other options in the menu in the bottom right!";
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


async function startDestashFlow(sender_psid, customer) {
    let response;
    if (customer.wants_destash_notification) {
        response = { text: "It looks like you're already on the list for destash notifications!" };
    } else if (customer.email) {
        await updateDestashState(customer, "AWAITING_DESTASH_EMAIL_CONFIRMATION");
        response = {
            text: `Can I use ${customer.email} to notify you about the destash?`,
            quick_replies: [
                { content_type: "text", title: "Yes", payload: "DESTASH_CONFIRM_EMAIL_YES" },
                { content_type: "text", title: "No", payload: "DESTASH_CONFIRM_EMAIL_NO" }
            ]
        };
    } else {
        await updateDestashState(customer, "AWAITING_DESTASH_EMAIL_INPUT");
        response = { text: "To get notified about the destash, please provide your email address." };
    }
    await callSendAPI(sender_psid, response);
}

// --- Message Handler ---
async function handleMessage(sender_psid, received_message) {
    if (received_message.is_echo) {
        console.log(`[WEBHOOK] ↩️ Echo message from PSID ${sender_psid}, ignoring.`);
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
            const response = { text: "Thanks for the attachment, I'll review this manually! If you want to order, please use the \"Visit Shop\" button in the menu in the bottom right." };
            callSendAPI(sender_psid, response);
        } else {
            console.log(`[WEBHOOK] ⚠️ Unknown message type from PSID ${sender_psid}:`, JSON.stringify(received_message));
            const response = { "text": "Sorry, I didn't understand that. You can find all options in the menu in the bottom right!" };
            callSendAPI(sender_psid, response);
        }
        return; // Stop further processing
    }
    let destashState = customer.destash_conversation_state;
    let destashData = customer.destash_conversation_data;

    // Global command check for "destash"
    if (lowerCaseMessageText.includes("destash")) {
        await startDestashFlow(sender_psid, customer);
        return;
    }

    // Handle destash conversation flow
    if (destashState) {
        if (quickReplyPayload) {
            if (destashState === "AWAITING_DESTASH_EMAIL_CONFIRMATION") {
                if (quickReplyPayload === "DESTASH_CONFIRM_EMAIL_YES") {
                    customer.wants_destash_notification = true;
                    await customer.save();
                    await clearDestashState(customer);
                    response = { text: "Awesome, thank you! I've added you to the list." };
                    await callSendAPI(sender_psid, response);
                    return;
                } else if (quickReplyPayload === "DESTASH_CONFIRM_EMAIL_NO") {
                    await updateDestashState(customer, "AWAITING_DESTASH_EMAIL_INPUT");
                    response = { text: "No problem. Please provide the email address you'd like to use." };
                    await callSendAPI(sender_psid, response);
                    return;
                }
            } else if (destashState === "AWAITING_DESTASH_NEW_EMAIL_CONFIRMATION") {
                if (quickReplyPayload === "DESTASH_NEW_EMAIL_YES") {
                    customer.email = destashData.newEmail;
                    customer.wants_destash_notification = true;
                    await customer.save();
                    await clearDestashState(customer);
                    response = { text: "Awesome, thank you! I've added you to the list." };
                    await callSendAPI(sender_psid, response);
                    return;
                } else if (quickReplyPayload === "DESTASH_NEW_EMAIL_NO") {
                    await updateDestashState(customer, "AWAITING_DESTASH_EMAIL_INPUT");
                    response = { text: "No problem. Please provide the email address you'd like to use." };
                    await callSendAPI(sender_psid, response);
                    return;
                }
            }
        } else if (messageText && destashState === "AWAITING_DESTASH_EMAIL_INPUT") {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (emailRegex.test(messageText)) {
                await updateDestashState(customer, "AWAITING_DESTASH_NEW_EMAIL_CONFIRMATION", { newEmail: messageText });
                response = {
                    text: `Is ${messageText} correct?`,
                    quick_replies: [
                        { content_type: "text", title: "Yes", payload: "DESTASH_NEW_EMAIL_YES" },
                        { content_type: "text", title: "No", payload: "DESTASH_NEW_EMAIL_NO" }
                    ]
                };
            } else {
                response = { text: "That doesn't look like a valid email. Please try again." };
            }
            await callSendAPI(sender_psid, response);
            return;
        }
    }

    // Handle Text Quick Replies for main conversation
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
        if (lowerCaseMessageText.includes("restart")) {
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
            response = { text: "Your session has been reset. Please use the menu below to start a new order." };
            callSendAPI(sender_psid, response);
            return;
        }

        // We only process state-specific text inputs now (like address or email).
        // General commands should use the Persistent Menu or Postback buttons.
        if (currentState === "AWAITING_GROUP_ORDER_SELECTION") {
            const selectedGroupOrder = currentData.availableGroupOrders.find(go =>
                go.name.toLowerCase() === lowerCaseMessageText || String(go.id) === messageText
            );

            if (selectedGroupOrder) {
                await proceedToOrderSelection(sender_psid, customer, selectedGroupOrder.id);
                return;
            } else {
                response = { text: "Sorry, I couldn't find a group order matching that name or ID. Please try again, or check the menu in the bottom right for help." };
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
        else if (currentState === "ORDERING_CHECK_ADDRESS") {
            if (lowerCaseMessageText.includes("yes")) {
                await updateCustomerState(customer, "ORDERING_SELECT_PRODUCT");
                response = { text: "Great! Please use the button below to select your items." };
                await callSendAPI(sender_psid, response);
                await sendProductSelectionWebviewButton(sender_psid, currentData.groupOrderId);
                return;
            } else if (lowerCaseMessageText.includes("no")) {
                await updateCustomerState(customer, "ORDERING_AWAITING_ADDRESS");
                response = { text: "Okay, please provide your updated details in this format (separate each part with a comma):\nFull Name, Email, Street Address, City, State, Zip" };
                await callSendAPI(sender_psid, response);
                return;
            }
        }



        else if (currentState === "AWAITING_ORDER_CONFIRMATION" || currentState === "AWAITING_PAYMENT_CONFIRMATION" || currentState === "ORDERING_SELECT_PRODUCT") {
            // Ignore random text in these states and prompt them to use the buttons
            response = { text: "Please use the buttons provided above to manage your order, or use the menu in the bottom right for more options." };
        }
        // Default / Fallback
        else {
            console.log(`[WEBHOOK] Text fallback for PSID: ${sender_psid}. Re-sending shop card.`);
            await startOrderFlow(sender_psid, customer);
            return;
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

    let { customer, created } = await getCustomerAndState(sender_psid);
    let currentState = customer.conversation_state || 'INITIAL';
    let currentData = customer.conversation_data || {};

    // Welcome new users who click the Get Started button
    if (payload === 'GET_STARTED') {
        console.log(`[WEBHOOK] 🎉 GET_STARTED postback from PSID: ${sender_psid}`);
        // Ensure they have the user-level menu
        await setUserPersistentMenu(sender_psid);
        // Send the uncollapsed card
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
    } else if (payload === 'DESTASH_SIGNUP') {
        await startDestashFlow(sender_psid, customer);
        return;
    }
    // Backward compatibility for existing flows
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

    const currentData = customer.conversation_data || {};
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
