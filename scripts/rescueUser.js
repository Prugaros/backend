require('dotenv').config();
const db = require('../models');
const { Customer } = db;

async function rescueUser() {
    const psid = '26002439056075746';
    console.log(`Attempting to rescue PSID: ${psid}`);
    try {
        const [customer, created] = await Customer.findOrCreate({
            where: { facebook_psid: psid },
            defaults: {
                facebook_psid: psid,
                conversation_state: 'INITIAL',
                conversation_data: {}
            }
        });
        console.log(`Customer record ${created ? 'created' : 'found'}. ID: ${customer.id}`);
    } catch (error) {
        console.error("Error during rescue:", error);
    } finally {
        process.exit();
    }
}

rescueUser();
