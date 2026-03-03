require('dotenv').config();
const axios = require('axios');
const db = require('../models');
const { Customer } = db;
const { Op } = require('sequelize');

const PAGE_ACCESS_TOKEN = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

async function clearUserLevelMenus() {
    console.log("Starting to clear User-Level Persistent Menu overrides...");
    try {
        const customers = await Customer.findAll({
            where: {
                facebook_psid: { [Op.not]: null }
            }
        });

        console.log(`Found ${customers.length} customers to process.`);

        let successCount = 0;
        let failCount = 0;

        for (const customer of customers) {
            const psid = customer.facebook_psid;
            console.log(`Clearing menu for PSID: ${psid}`);
            const url = `https://graph.facebook.com/v25.0/me/custom_user_settings?psid=${psid}&params=["persistent_menu"]&access_token=${PAGE_ACCESS_TOKEN}`;

            try {
                await axios.delete(url);
                successCount++;
            } catch (error) {
                console.error(`Failed to clear menu for PSID ${psid}:`, error.response ? error.response.data : error.message);
                failCount++;
            }

            // Wait 200ms to respect rate limits
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        console.log(`Finished clearing overrides. Success: ${successCount}, Failed: ${failCount}`);
    } catch (error) {
        console.error("Error running clearUserLevelMenus:", error);
    } finally {
        process.exit();
    }
}

clearUserLevelMenus();
