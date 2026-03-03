'use strict';

const axios = require('axios');
const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

async function callSendAPI(sender_psid, response, tag = null) {
    let request_body = {
        recipient: { id: sender_psid },
        message: response
    };
    if (tag) {
        request_body.messaging_type = "MESSAGE_TAG";
        request_body.tag = tag;
    } else {
        request_body.messaging_type = "RESPONSE";
    }
    const graphApiUrl = `https://graph.facebook.com/v25.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
    console.log(`[FB API] Sending message to PSID ${sender_psid}:`, JSON.stringify(response));
    try {
        const result = await axios.post(graphApiUrl, request_body);
        console.log(`[FB API] Message sent successfully to PSID ${sender_psid}. Message ID:`, result.data?.message_id);
    } catch (error) {
        console.error(`[FB API] Unable to send message to PSID ${sender_psid}:`, error.response?.data || error.message);
    }
}

async function setUserPersistentMenu(sender_psid) {
    const frontendBaseUrl = process.env.FRONTEND_URL;
    if (!frontendBaseUrl) {
        console.error("[FB API] FRONTEND_URL missing, cannot set persistent menu webview URL.");
        return;
    }

    const graphApiUrl = `https://graph.facebook.com/v25.0/me/custom_user_settings?access_token=${PAGE_ACCESS_TOKEN}`;
    const webviewUrl = `${frontendBaseUrl}/messenger-order?psid=${encodeURIComponent(sender_psid)}`;

    const payload = {
        psid: sender_psid,
        persistent_menu: [
            {
                locale: "default",
                composer_input_disabled: false,
                call_to_actions: [
                    {
                        type: "web_url",
                        title: "Visit Shop",
                        url: webviewUrl,
                        webview_height_ratio: "compact",
                        messenger_extensions: false // Or true if you configure them!
                    },
                    {
                        type: "web_url",
                        title: "Contact Us",
                        url: "https://m.me/naomi.seijo.2025"
                    }
                ]
            }
        ]
    };

    try {
        const result = await axios.post(graphApiUrl, payload);
        console.log(`[FB API] User-level persistent menu set successfully for PSID ${sender_psid}.`);
        return true;
    } catch (error) {
        console.error(`[FB API] Unable to set persistent menu for PSID ${sender_psid}:`, error.response?.data || error.message);
        return false;
    }
}

module.exports = { callSendAPI, setUserPersistentMenu };
