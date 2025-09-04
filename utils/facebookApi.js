'use strict';

const axios = require('axios');
const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

async function callSendAPI(sender_psid, response) {
    let request_body = { recipient: { id: sender_psid }, message: response };
    const graphApiUrl = `https://graph.facebook.com/v19.0/me/messages?access_token=${PAGE_ACCESS_TOKEN}`;
    try {
        await axios.post(graphApiUrl, request_body);
    } catch (error) {
        console.error("Unable to send message:", error.response?.data || error.message);
    }
}

module.exports = { callSendAPI };
