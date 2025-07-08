'use strict';

const axios = require('axios');
const db = require("../models");
const Customer = db.Customer;
const Order = db.Order;
const OrderItem = db.OrderItem;
const GroupOrder = db.GroupOrder;
const Product = db.Product;
const { Op } = require("sequelize");

// Access token and verify token from .env file
const VERIFY_TOKEN = process.env.FACEBOOK_VERIFY_TOKEN;
const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

// --- Webhook Verification ---
exports.verifyWebhook = (req, res) => {
    let mode = req.query['hub.mode'];
    let token = req.query['hub.verify_token'];
    let challenge = req.query['hub.challenge'];

    if (mode && token) {
        if (mode === 'subscribe' && token === VERIFY_TOKEN) {
            console.log('WEBHOOK_VERIFIED');
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
            console.log('--- Received Raw Webhook Event ---');
            console.log(JSON.stringify(webhook_event, null, 2));

            let sender_psid = webhook_event.sender.id;
            if (!sender_psid) {
                console.error("Missing sender PSID in webhook event.");
                return;
            }
            console.log('Sender PSID: ' + sender_psid);

            if (webhook_event.message) {
                console.log('Event Type: Message');
                handleMessage(sender_psid, webhook_event.message);
            } else if (webhook_event.postback) {
                console.log('Event Type: Postback');
                handlePostback(sender_psid, webhook_event.postback);
            } else if (webhook_event.read) {
                 console.log('Event Type: Read Receipt');
            } else {
                console.log("Received unhandled webhook event type:", webhook_event);
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

// --- Helper function to update customer state ---
async function updateCustomerState(customer, newState, newData = null) {
    customer.conversation_state = newState;
    if (newData !== null) {
        customer.conversation_data = newData;
    }
    await customer.save();
    console.log(`Updated state for ${customer.facebook_psid}`);
}

// --- Helper function to clear customer state ---
async function clearCustomerState(customer) {
    customer.conversation_state = 'INITIAL';
    customer.conversation_data = {};
    await customer.save();
    console.log(`Cleared state for ${customer.facebook_psid}`);
}


// --- Message Handler ---
async function handleMessage(sender_psid, received_message) {
    if (received_message.is_echo) {
        console.log("Ignoring echo message from page.");
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
        console.log(`Handling quick reply click with payload: ${quickReplyPayload}`);

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
            console.log(`Unhandled text quick reply payload: ${quickReplyPayload}`);
        }
    }

exports.handlePaymentVerified = handlePaymentVerified;

    // Handle Regular Text Messages
    if (messageText) {
        console.log(`Handling text message from ${sender_psid}: ${lowerCaseMessageText}`);
        if (lowerCaseMessageText === "help") {
                    let helpText = "Here are the available commands:\n\n";
                    if (currentState === "INITIAL") {
                        helpText += "- order: Start a new order\n";
                    } else if (currentState === "ORDERING_AWAITING_ADDRESS") {
                        helpText += "- Provide your details in the format: Full Name, Email, Street Address, City, State, Zip\n";
                    } else if (currentState === "ORDERING_CHECK_ADDRESS") {
                        helpText += "- yes - Confirm your address\n";
                        helpText += "- no - Update your address\n";
                    } else if (currentState === "ORDERING_SELECT_PRODUCT") {
                        helpText += "- Use the 'Select Items' button to add products to your order\n";
                        helpText += "- Type 'done' when you are finished selecting products\n";
                        helpText += "- restart: Start over with a new order\n";
                        helpText += "- cart: View your current cart\n";
                    } else if (currentState === "AWAITING_ORDER_CONFIRMATION") {
                        helpText += "- confirm: Confirm your order\n";
                        helpText += "- edit: Edit your order\n";
                        helpText += "- cancel: Cancel your order\n";
                    } else if (currentState === "AWAITING_PAYMENT_CONFIRMATION") {
                        helpText += "- paid: Confirm your payment\n";
                        helpText += "- edit: Edit your order\n";
                        helpText += "- cart: View your current cart\n";
                    } else if (currentState === "AWAITING_GROUP_ORDER_SELECTION") {
                        helpText += "- Select a group order by typing its name or ID, or by using the quick replies\n";
                    }
                    response = { text: helpText };
                    callSendAPI(sender_psid, response);
                    return;
                }
        // Start Order
        else if (lowerCaseMessageText === "order" && currentState === "INITIAL") {
            try {
                const activeGroupOrders = await GroupOrder.findAll({ where: { status: "Active" } });
                if (activeGroupOrders.length === 0) {
                    response = { text: "Sorry, there's no active group order right now." };
                } else if (activeGroupOrders.length > 1) {
                    currentData = { customerId: customer.id, currentOrderItems: {}, availableGroupOrders: activeGroupOrders.map(go => ({ id: go.id, name: go.name })) };

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
                    callSendAPI(sender_psid, response);
                    return;
                }
                 else {
                    currentData = { customerId: customer.id, groupOrderId: activeGroupOrders[0].id, currentOrderItems: {} };
                    if (customer.name && customer.email && customer.street_address && customer.city && customer.state && customer.zip) {
                        await updateCustomerState(customer, "ORDERING_CHECK_ADDRESS", currentData);
                        response = {
                            text: `Welcome back, ${customer.name}!\nIs this info still correct?\n\nEmail: ${customer.email}\nAddress: ${customer.street_address}, ${customer.city}, ${customer.state} ${customer.zip}`,
                            quick_replies: [
                                { content_type: "text", title: "Yes", payload: "CONFIRM_ADDRESS_YES" },
                                { content_type: "text", title: "No", payload: "CONFIRM_ADDRESS_NO" }
                            ]
                        };
                        // callSendAPI(sender_psid, response);
                    } else {
                        await updateCustomerState(customer, "ORDERING_AWAITING_ADDRESS", currentData);
                        response = { text: "To start your order, please provide your details in this format (separate each part with a comma):\nFull Name, Email, Street Address, City, State, Zip" };
                        // callSendAPI(sender_psid, response);
                    }
                }
            } catch (error) {
                console.error("Error starting order process:", error);
                response = { text: "Sorry, something went wrong while starting your order." };
                 callSendAPI(sender_psid, response);
            }
        } else if (currentState === "AWAITING_GROUP_ORDER_SELECTION") {
             const selectedGroupOrder = currentData.availableGroupOrders.find(go => (
                go.name.toLowerCase() === lowerCaseMessageText || String(go.id) === messageText
            ));

            if (selectedGroupOrder) {
                currentData.groupOrderId = selectedGroupOrder.id;
                await updateCustomerState(customer, "ORDERING_CHECK_ADDRESS", currentData);
                 if (customer.name && customer.email && customer.street_address && customer.city && customer.state && customer.zip) {
                    response = {
                        text: `Welcome back, ${customer.name}!\nIs this info still correct?\n\nEmail: ${customer.email}\nAddress: ${customer.street_address}, ${customer.city}, ${customer.state} ${customer.zip}`,
                            quick_replies: [
                                { content_type: "text", title: "Yes, looks good!", payload: "CONFIRM_ADDRESS_YES" },
                                { content_type: "text", title: "No, update it", payload: "CONFIRM_ADDRESS_NO" }
                            ]
                        };
                    // callSendAPI(sender_psid, response);
                    } else {
                        await updateCustomerState(customer, "ORDERING_AWAITING_ADDRESS", currentData);
                        response = { text: "To start your order, please provide your details in this format (separate each part with a comma):\nFull Name, Email, Street Address, City, State, Zip" };
                         // callSendAPI(sender_psid, response);
                    }
            } else {
                response = { text: "Sorry, I couldn't find a group order matching that name or ID. Please try again, or type 'help' for available commands." };
                 callSendAPI(sender_psid, response);
                 return;
            }
        }
        // Handle Address/Info Input
        else if (currentState === "ORDERING_AWAITING_ADDRESS") {
            console.log("Received potential details:", messageText);
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



        // Handle 'cart' command
        else if (lowerCaseMessageText === "cart" && currentState === "ORDERING_SELECT_PRODUCT") {
            if (Object.keys(currentData.currentOrderItems || {}).length === 0) {
                response = { text: "Your cart is empty. Use the 'Select Items' button to add products." };
            } else {
                let cartText = "Your current cart:\n";
                let subtotal = 0;
                for (const productId in currentData.currentOrderItems) {
                    const item = currentData.currentOrderItems[productId];
                    cartText += `- ${item.name} (Qty: ${item.quantity}): $${(item.price * item.quantity).toFixed(2)}\n`;
                    subtotal += item.price * item.quantity;
                }
                cartText += `\nSubtotal: $${subtotal.toFixed(2)}`;
                response = { text: cartText };
            }
        }
        // Handle 'restart' during product selection
        else if (lowerCaseMessageText === "restart" && currentState === "ORDERING_SELECT_PRODUCT") {
            await clearCustomerState(customer);
            response = { text: "Okay, let's start over. Please type 'order' to begin." };
        }
        // Handle 'help' command
        
        // Handle 'Done' - This should now primarily be triggered implicitly when webview closes and sends data
        else if (lowerCaseMessageText === "done" && currentState === "ORDERING_SELECT_PRODUCT") {
            if (Object.keys(currentData.currentOrderItems || {}).length === 0) {
                response = { text: "You haven't added any items via the selection window yet! Click the 'Select Items' button again or type 'cancel'." };
            } else {
                try {
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

                    response = {
                        text: invoiceText + "\n\nPlease confirm your order details above.",
                        quick_replies: [
                            { content_type: "text", title: "👍 Confirm", payload: `CONFIRM_ORDER:${order.id}` },
                            { content_type: "text", title: "✏️ Edit", payload: `EDIT_ORDER:${order.id}` },
                            { content_type: "text", title: "❌ Cancel", payload: `CANCEL_ORDER:${order.id}` }
                        ]
                    };

                    currentData.orderId = order.id;
                    // currentData.currentOrderItems = {}; // Clear cart from state
                    await updateCustomerState(customer, "AWAITING_ORDER_CONFIRMATION", currentData);
                    await callSendAPI(sender_psid, response);
                    return;
                } catch (error) {
                    console.error("Error finalizing order:", error);
                    response = { text: "Sorry, there was an error finalizing your order." };
                }
            }
        }
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
                response = { text: "Please confirm, edit, or cancel your order." };
            }
        } 

        else if (currentState === "AWAITING_PAYMENT_CONFIRMATION") {
            if (lowerCaseMessageText === "cart") {
                if (Object.keys(currentData.currentOrderItems || {}).length === 0) {
                    response = { text: "Your cart is empty." };
                } else {
                    let cartText = "Your current cart:\n";
                    let subtotal = 0;
                    for (const productId in currentData.currentOrderItems) {
                        const item = currentData.currentOrderItems[productId];
                        cartText += `- ${item.name} (Qty: ${item.quantity}): $${(item.price * item.quantity).toFixed(2)}\n`;
                        subtotal += item.price * item.quantity;
                    }
                    cartText += `\nSubtotal: $${subtotal.toFixed(2)}`;
                response = { text: cartText };
            }
            } else if (lowerCaseMessageText === "edit") {
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
        console.log(`Handling attachment message from ${sender_psid}`);
        response = { text: "Thanks for the attachment! If you want to order, please type 'order'." };
    }
    // Fallback
    else {
         console.log(`Handling unknown message type from ${sender_psid}`);
         response = { "text": "Sorry, I didn't understand that." }
     }

     // Send the response message if one was generated
     if (response) {
        callSendAPI(sender_psid, response);
     }
 }

// --- Postback Handler ---
async function handlePostback(sender_psid, received_postback) {
    let response;
    const payload = received_postback.payload;
    let customer = await getCustomerAndState(sender_psid);
    let currentState = customer.conversation_state || 'INITIAL';
    let currentData = customer.conversation_data || {};

    console.log(`Handling postback from ${sender_psid} with payload: ${payload}`);

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
        console.log(`Unhandled postback payload: ${payload} in state: ${currentState}`);
        response = { "text": `Received: ${payload}` };
    }

    if (response) { callSendAPI(sender_psid, response); }
}

// --- Specific Handler Functions ---

async function handleConfirmOrder(sender_psid, payload, customer) {
    const orderId = parseInt(payload.split(':')[1]);
    let currentData = customer.conversation_data || {};

    if (!isNaN(orderId) && orderId === currentData.orderId) {
        let paymentInstructionsText = `Awesome! Please send payment via friends and family to one of these two options:\n\n`;
        if (process.env.VENMO_USERNAME) { paymentInstructionsText += `Venmo (preferred): ${process.env.VENMO_USERNAME}\n(Last 4 digits: 5176 - Add this if needed)\n\n`; }
        if (process.env.PAYPAL_EMAIL) { paymentInstructionsText += `or\nPayPal: ${process.env.PAYPAL_EMAIL}\n`; }
        await callSendAPI(sender_psid, { text: paymentInstructionsText });

        await new Promise(resolve => setTimeout(resolve, 2000));
        const confirmationResponse = {
            text: "Please click below once you've sent the payment:",
            quick_replies: [ { content_type: "text", title: "✅ Paid", payload: `MARK_PAID_CLAIMED:${orderId}` } ]
        };
        await callSendAPI(sender_psid, confirmationResponse);
        await updateCustomerState(customer, 'AWAITING_PAYMENT_CONFIRMATION', currentData);
    } else {
        console.warn(`Order confirmation payload mismatch/invalid. Payload: ${payload}, State Order ID: ${currentData.orderId}`);
        await callSendAPI(sender_psid, { text: "Sorry, there was an issue confirming your order." });
    }
}

async function handleEditOrder(sender_psid, payload, customer) {
     const orderId = parseInt(payload.split(':')[1]);
     let currentData = customer.conversation_data || {};
 
     if (!isNaN(orderId)) {
         currentData.orderId = null;
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
        try {
            const customerIdForCancel = currentData?.customerId;
            if (!customerIdForCancel) { console.error(`Cannot cancel order ${orderId}, customer ID missing.`); response = { text: "Sorry, error cancelling." }; }
            else {
                const [num] = await Order.update({ payment_status: 'Cancelled' }, { where: { id: orderId, customer_id: customerIdForCancel } });
                response = (num === 1) ? { text: "Okay, your order has been cancelled." } : { text: "Sorry, couldn't find order to cancel." };
            }
            await clearCustomerState(customer);
            return;
        } catch(error) { console.error(`Error cancelling order ${orderId}:`, error); response = { text: "Sorry, error cancelling." }; }
    } else { response = { text: "Sorry, issue cancelling your order." }; }
    callSendAPI(sender_psid, response);
}

async function handleMarkPaidClaimed(sender_psid, payload, customer) {
    let response;
    const orderId = parseInt(payload.split(':')[1]);
    if (!isNaN(orderId)) {
        try {
            if (!customer) {
                console.error(`Cannot mark order ${orderId} paid, customer object invalid.`);
                response = { text: "Sorry, error finding your record." };
            } else {
                const [num] = await Order.update({ payment_status: 'Payment Claimed' }, { where: { id: orderId, customer_id: customer.id } });
                response = (num === 1) ? { text: "Thanks for confirming! We'll verify payment soon." } : { text: "Sorry, couldn't find that order." };
                await callSendAPI(sender_psid, response);
                return;
            }
        } catch (error) {
            console.error(`Error marking order ${orderId} paid:`, error);
            response = { text: "Sorry, error updating payment status." };
        }
    } else {
        response = { text: "Sorry, couldn't identify which order." };
    }
    callSendAPI(sender_psid, response);
}

async function handlePaymentVerified(sender_psid, orderId, customer) {
    console.error("handlePaymentVerified called with:", sender_psid, orderId, customer);
    try {
        const order = await Order.findByPk(orderId);
        if (!order) {
            console.error(`Order ${orderId} not found.`);
            await callSendAPI(sender_psid, { text: "Sorry, couldn't find that order." });
            return;
        }

        console.error("handlePaymentVerified order:", order);

        if (order.payment_status !== 'Paid') {
            console.warn(`Order ${orderId} payment status is not 'Paid'.`);
            await callSendAPI(sender_psid, { text: "Sorry, payment verification is still pending." });
            return;
        }

        const response = { text: "Great news! Your payment has been verified. Thanks for your order!" };
        console.error("handlePaymentVerified response:", response);
        console.error("About to call callSendAPI with:", sender_psid, response);
        await callSendAPI(sender_psid, response);
        await clearCustomerState(customer);
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

    try {
        const groupOrder = await GroupOrder.findByPk(groupOrderId);
        if (!groupOrder || groupOrder.status !== 'Active') {
             await callSendAPI(sender_psid, { text: "Sorry, this group order is no longer active." });
             await clearCustomerState(await getCustomerAndState(sender_psid));
             return;
        }
    } catch (error) {
         console.error("Error checking group order status before sending webview button:", error);
         await callSendAPI(sender_psid, { text: "Sorry, something went wrong before loading products." });
         return;
    }

    const response = {
        attachment: {
            type: "template",
            payload: {
                template_type: "button",
                text: "Click the button below to browse products and add items to your order.\n \nType 'done' when you are finished selecting products.",
                buttons: [
                    {
                        type: "web_url",
                        url: webviewUrl,
                        title: "Select Items",
                        webview_height_ratio: "tall",
                        messenger_extensions: true
                    }
                ]
            }
        }
    };
    await callSendAPI(sender_psid, response);
}


// --- Send API Wrapper ---
async function callSendAPI(sender_psid, response) {
    let request_body = { recipient: { id: sender_psid }, message: response };
    const graphApiUrl = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
    try {
        console.error("callSendAPI sender_psid:", sender_psid);
        console.error("callSendAPI response:", response);
        await axios.post(graphApiUrl, request_body);
        console.log('Message sent successfully!');
    } catch (error) {
        console.error("Unable to send message:", error.response?.data || error.message);
    }
}
}
