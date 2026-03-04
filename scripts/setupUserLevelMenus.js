require('dotenv').config();
const db = require('../models');
const { Customer } = db;
const { Op } = require('sequelize');
const { setUserPersistentMenu } = require('../utils/facebookApi');

async function setupUserLevelMenus() {
    console.log("Starting User-Level Persistent Menu assignment...");
    try {
        const customers = await Customer.findAll({
            where: {
                facebook_psid: { [Op.not]: null }
            }
        });

        console.log(`Found ${customers.length} customers to update.`);

        let successCount = 0;
        let failCount = 0;

        for (const customer of customers) {
            const success = await setUserPersistentMenu(customer.facebook_psid, customer);
            if (success) {
                successCount++;
            } else {
                failCount++;
            }
            // slight delay to respect rate limit (10 per user per 10min, but global limits still apply)
            // waiting 200ms between requests
            await new Promise(resolve => setTimeout(resolve, 200));
        }

        console.log(`Finished processing menus. Success: ${successCount}, Failed: ${failCount}`);
    } catch (error) {
        console.error("Error running setupUserLevelMenus:", error);
    } finally {
        process.exit();
    }
}

setupUserLevelMenus();
