require('dotenv').config();
const axios = require('axios');

const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

async function setupPersistentMenu() {
    if (!PAGE_ACCESS_TOKEN) {
        console.error("FACEBOOK_PAGE_ACCESS_TOKEN not found in environment variables.");
        return;
    }

    const url = `https://graph.facebook.com/v25.0/me/messenger_profile?access_token=${PAGE_ACCESS_TOKEN}`;

    const frontendUrl = process.env.FRONTEND_URL;
    if (!frontendUrl) {
        console.error("FRONTEND_URL not found in environment variables.");
        return;
    }
    const webviewUrl = `${frontendUrl}/messenger-order`;

    const payload = {
        "get_started": {
            "payload": "GET_STARTED"
        },
        "persistent_menu": [
            {
                "locale": "default",
                "composer_input_disabled": false,
                "call_to_actions": [
                    {
                        "type": "web_url",
                        "title": "Shop Now",
                        "url": webviewUrl,
                        "webview_height_ratio": "compact"
                    },
                    {
                        "type": "web_url",
                        "title": "Signup for Destash",
                        "url": `${frontendUrl}/destash-signup`,
                        "webview_height_ratio": "compact"
                    },
                    {
                        "type": "web_url",
                        "title": "Contact Us",
                        "url": "https://m.me/naomi.seijo.2025"
                    }
                ]
            }
        ]
    };

    try {
        console.log("Setting up Persistent Menu...");
        const response = await axios.post(url, payload, {
            headers: { 'Content-Type': 'application/json' }
        });
        console.log("Success! Response from Facebook:", response.data);
    } catch (error) {
        console.error("Failed to set Persistent Menu:", error.response ? error.response.data : error.message);
    }
}

setupPersistentMenu();
