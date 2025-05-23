const db = require("../models");
const Customer = db.Customer;
const GroupOrder = db.GroupOrder;
const Product = db.Product;
const { Op } = require("sequelize");

// --- Helper function to update customer state (Duplicated from webhook controller) ---
// TODO: Consider moving helper functions to a shared utility file later
async function updateCustomerState(customer, newState, newData = null) {
    customer.conversation_state = newState;
    if (newData !== null) {
        customer.conversation_data = newData; // Setter handles stringify
    }
    await customer.save();
    console.log(`Updated state for ${customer.facebook_psid} to ${newState} via webview controller`);
}


// Get data needed for the order webview
exports.getOrderData = async (req, res) => {
    const psid = req.query.psid;

    if (!psid) {
        return res.status(400).send({ message: "Missing PSID." });
    }

    try {
        const customer = await Customer.findOne({ where: { facebook_psid: psid } });
        if (!customer) {
            return res.status(404).send({ message: "Customer not found." });
        }

        // Allow access even if state isn't exactly ORDERING_SELECT_PRODUCT,
        // as user might open it while in AWAITING_ADDRESS etc.
        // We primarily need the groupOrderId from the state data.
        const currentData = customer.conversation_data || {};
        const groupOrderId = currentData.groupOrderId;

        if (!groupOrderId) {
             console.error(`Group Order ID missing from customer state for PSID ${psid}`);
             // Maybe allow access but show an error message in the webview?
             return res.status(403).send({ message: "Cannot determine active group order context." });
        }

        const groupOrder = await GroupOrder.findByPk(groupOrderId, {
            include: [{
                model: Product,
                as: 'products',
                where: { is_active: true },
                required: false,
                attributes: ['id', 'name', 'description', 'price', 'image_url']
            }]
        });

        if (!groupOrder || groupOrder.status !== 'Active') {
            // If group order isn't active, maybe still show products but disable adding?
            // For now, treat as not found.
            return res.status(404).send({ message: "Active group order not found." });
        }

        res.send({
            groupOrderName: groupOrder.name,
            products: groupOrder.products || [],
            // Send current cart state if it exists
            currentCart: currentData.currentOrderItems || {}
        });

    } catch (error) {
        console.error(`Error fetching webview order data for PSID ${psid}:`, error);
        res.status(500).send({ message: "Error retrieving order data." });
    }
};

// Update the user's cart state from the webview
exports.updateCart = async (req, res) => {
    const psid = req.query.psid;
    const cartItems = req.body.items; // Expecting format like { productId: quantity, ... }

     if (!psid) {
        return res.status(400).send({ message: "Missing PSID." });
    }
     if (!cartItems || typeof cartItems !== 'object') {
         return res.status(400).send({ message: "Invalid cart items data." });
     }

    try {
        const customer = await Customer.findOne({ where: { facebook_psid: psid } });
        if (!customer) {
            return res.status(404).send({ message: "Customer not found." });
        }

        // Allow cart updates as long as there's group order context
        let currentData = customer.conversation_data || {};
        if (!currentData.groupOrderId) {
             return res.status(403).send({ message: "Missing group order context." });
        }

        const productIds = Object.keys(cartItems).map(id => parseInt(id)).filter(id => !isNaN(id));
        const products = await Product.findAll({ where: { id: { [Op.in]: productIds }, is_active: true } });

        const validatedCart = {};
        products.forEach(p => {
            const quantity = parseInt(cartItems[p.id]);
            if (!isNaN(quantity) && quantity > 0) {
                 validatedCart[p.id] = {
                     productId: p.id,
                     name: p.name,
                     price: parseFloat(p.price),
                     quantity: quantity
                 };
            }
        });

        currentData.currentOrderItems = validatedCart;
        // Update state, keeping the existing state name (e.g., ORDERING_SELECT_PRODUCT)
        await updateCustomerState(customer, customer.conversation_state, currentData);

        res.send({ message: "Cart updated successfully." });

    } catch (error) {
         console.error(`Error updating cart for PSID ${psid}:`, error);
        res.status(500).send({ message: "Error updating cart." });
    }
};
