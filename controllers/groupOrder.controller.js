const db = require("../models");
const GroupOrder = db.GroupOrder;
const Product = db.Product; // Needed for associating products
const GroupOrderItem = db.GroupOrderItem; // Needed for managing associations
const { Op } = require("sequelize");
const axios = require('axios'); // For making HTTP requests (e.g., to Facebook API)

// Create and Save a new GroupOrder
exports.create = async (req, res) => {
  // Validate request
  if (!req.body.name) {
    res.status(400).send({ message: "Group Order name cannot be empty!" });
    return;
  }

  // Create a GroupOrder object
  const groupOrderData = {
    name: req.body.name,
    start_date: req.body.start_date || null,
    end_date: req.body.end_date || null,
    status: req.body.status || 'Draft', // Default to Draft
    // facebook_post_id will be set later when 'started'
  };

  try {
    const groupOrder = await GroupOrder.create(groupOrderData);

    // Optional: Associate products if product IDs are sent in the request
    if (req.body.productIds && req.body.productIds.length > 0) {
      const products = await Product.findAll({
        where: { id: { [Op.in]: req.body.productIds } }
      });
      if (products.length !== req.body.productIds.length) {
         // Handle case where some product IDs were invalid - maybe return partial success?
         console.warn("Some product IDs provided for group order creation were invalid.");
      }
      // Use Sequelize's association method to add products
      await groupOrder.setProducts(products); // This manages the GroupOrderItems join table
      // Note: setProducts replaces existing associations. Use addProducts to append.
    }

    res.send(groupOrder);
  } catch (err) {
    res.status(500).send({
      message: err.message || "Some error occurred while creating the Group Order.",
    });
  }
};

// Retrieve all GroupOrders from the database (can add filtering later)
exports.findAll = async (req, res) => {
   // TODO: Add filtering by status (Draft, Active, Closed) via query params if needed
  try {
    const data = await GroupOrder.findAll({
        include: [{ // Include associated products
            model: Product,
            as: 'products', // Use the alias defined in the association
            attributes: ['id', 'name', 'price', 'images'], // Select only needed product attributes
            through: { model: GroupOrderItem, attributes: [] } // Don't include join table attributes here
        }],
        order: [['createdAt', 'DESC']] // Order by creation date, newest first
    });
    res.send(data);
  } catch (err) {
    res.status(500).send({
      message: err.message || "Some error occurred while retrieving group orders.",
    });
  }
};

// Find a single GroupOrder with an id
exports.findOne = async (req, res) => {
  const id = req.params.id;

  try {
    const data = await GroupOrder.findByPk(id, {
        include: [{ // Include associated products
            model: Product,
            as: 'products',
            attributes: ['id', 'name', 'price', 'images', 'weight_oz'], // Get more details for single view
            through: { model: GroupOrderItem, attributes: [] }
        }]
    });
    if (data) {
      res.send(data);
    } else {
      res.status(404).send({ message: `Cannot find Group Order with id=${id}.` });
    }
  } catch (err) {
    res.status(500).send({ message: "Error retrieving Group Order with id=" + id });
  }
};

// Update a GroupOrder by the id in the request
exports.update = async (req, res) => {
  const id = req.params.id;

  if (!req.body) {
    return res.status(400).send({ message: "Data to update can not be empty!" });
  }

  // Separate product IDs from other group order data
  const { productIds, ...groupOrderData } = req.body;

  try {
    // Update basic GroupOrder fields first
    const [num] = await GroupOrder.update(groupOrderData, { where: { id: id } });

    if (num !== 1) {
      return res.status(404).send({ message: `Cannot update Group Order with id=${id}. Maybe it was not found.` });
    }

    // If productIds are provided, update the associations
    if (productIds !== undefined) { // Check if the key exists (even if empty array)
        const groupOrder = await GroupOrder.findByPk(id);
        if (!groupOrder) {
             // Should not happen if update above succeeded, but good check
            return res.status(404).send({ message: `Group Order with id=${id} not found after update.` });
        }
        if (productIds.length > 0) {
            const products = await Product.findAll({ where: { id: { [Op.in]: productIds } } });
             if (products.length !== productIds.length) {
                 console.warn("Some product IDs provided for group order update were invalid.");
             }
            await groupOrder.setProducts(products); // Overwrite associations
        } else {
            await groupOrder.setProducts([]); // Remove all associations if empty array sent
        }
    }

    res.send({ message: "Group Order was updated successfully." });

  } catch (err) {
    res.status(500).send({ message: "Error updating Group Order with id=" + id + ": " + err.message });
  }
};

// Delete a GroupOrder with the specified id
// Note: Consider implications - should this delete associated Orders?
// For now, we'll just delete the GroupOrder record itself.
// You might want soft delete (add an is_deleted flag) instead.
exports.delete = async (req, res) => {
  const id = req.params.id;

  try {
    // First, remove associations in the join table (GroupOrderItems)
    // This might not be strictly necessary depending on DB constraints, but safer
    const groupOrder = await GroupOrder.findByPk(id);
    if (groupOrder) {
        await groupOrder.setProducts([]); // Remove product associations
    } else {
         return res.status(404).send({ message: `Cannot delete Group Order with id=${id}. Maybe it was not found!` });
    }

    // Then, delete the GroupOrder itself
    const num = await GroupOrder.destroy({ where: { id: id } });

    if (num == 1) {
      res.send({ message: "Group Order was deleted successfully!" });
    } else {
       // This case might be redundant due to the findByPk check above
      res.status(404).send({ message: `Cannot delete Group Order with id=${id}. Maybe it was not found!` });
    }
  } catch (err) {
     // Check for foreign key constraint errors if Orders depend on GroupOrder
     if (err.name === 'SequelizeForeignKeyConstraintError') {
         return res.status(400).send({ message: `Cannot delete Group Order with id=${id} because it has associated orders. Please handle orders first.` });
     }
    res.status(500).send({ message: "Could not delete Group Order with id=" + id + ": " + err.message });
  }
};


// --- Special Actions ---

// Start a Group Order (Set status to Active, potentially post to FB later)
exports.startOrder = async (req, res) => {
    const id = req.params.id;
    try {
        const groupOrder = await GroupOrder.findByPk(id);
        if (!groupOrder) {
            return res.status(404).send({ message: `Group Order with id=${id} not found.` });
        }
        if (groupOrder.status !== 'Draft') {
            return res.status(400).send({ message: `Group Order is not in Draft status.` });
        }

        let facebookPostId = null; // Initialize placeholder

        try {
            // --- Facebook Post Logic ---
            const products = await groupOrder.getProducts({
                attributes: ['name', 'price', 'images', 'description'] // Fetch details needed for post
            });

            // 1. Format the post message (customize as needed)
            let postMessage = `✨ New Group Order Started: ${groupOrder.name} ✨\n\n`;
            postMessage += `Order between ${groupOrder.start_date ? groupOrder.start_date.toLocaleDateString() : 'now'} and ${groupOrder.end_date ? groupOrder.end_date.toLocaleDateString() : 'TBD'}.\n\n`;
            postMessage += `Available items:\n`;
            products.forEach(p => {
                postMessage += `- ${p.name} ($${p.price})${p.description ? ': ' + p.description : ''}\n`;
            });
            postMessage += `\nDM our page to place your order!`;

            // 2. Prepare for API call (Get Page ID and Token from .env)
            const pageId = process.env.FACEBOOK_PAGE_ID;
            const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
            const graphApiUrl = `https://graph.facebook.com/v19.0/${pageId}/feed`; // Use correct API version

            if (!pageId || !accessToken) {
                console.warn("Facebook Page ID or Access Token missing in .env. Skipping Facebook post.");
            } else {
                // 3. Make the API Call (Commented out for safety - requires valid token/permissions)
                /*
                console.log("Attempting to post to Facebook:", postMessage);
                const response = await axios.post(graphApiUrl, {
                    message: postMessage,
                    access_token: accessToken,
                    // Optional: Add link or image attachments if needed
                    // link: 'your_website_link',
                    // attached_media: products.map(p => ({ media_fbid: 'IMAGE_ID_IF_UPLOADED_SEPARATELY' })) // More complex
                });

                if (response.data && response.data.id) {
                    facebookPostId = response.data.id; // Store the actual post ID
                    console.log("Successfully posted to Facebook. Post ID:", facebookPostId);
                } else {
                    console.error("Failed to post to Facebook or get post ID:", response.data);
                }
                */
               console.log("Facebook post logic skipped (requires uncommenting and valid credentials/permissions). Message:", postMessage);
            }

        } catch (fbError) {
            console.error("Error during Facebook post attempt:", fbError.response?.data || fbError.message);
            // Decide if failure to post should prevent the order from starting
            // For now, we'll log the error but continue starting the order in our DB
        }

        // --- Update DB Status ---
        groupOrder.status = 'Active';
        groupOrder.facebook_post_id = facebookPostId; // Store the actual ID later
        groupOrder.start_date = new Date(); // Set start date when started
        await groupOrder.save();

        res.send({ message: "Group Order started successfully.", facebookPostId: facebookPostId });

    } catch (err) {
        res.status(500).send({ message: "Error starting Group Order with id=" + id + ": " + err.message });
    }
};

// End a Group Order (Set status to Closed)
exports.endOrder = async (req, res) => {
    const id = req.params.id;
    try {
        const groupOrder = await GroupOrder.findByPk(id);
        if (!groupOrder) {
            return res.status(404).send({ message: `Group Order with id=${id} not found.` });
        }
        if (groupOrder.status !== 'Active') {
            return res.status(400).send({ message: `Group Order is not Active.` });
        }

        groupOrder.status = 'Closed';
        groupOrder.end_date = new Date(); // Set end date when closed
        await groupOrder.save();

        res.send({ message: "Group Order closed successfully." });

    } catch (err) {
        res.status(500).send({ message: "Error closing Group Order with id=" + id + ": " + err.message });
    }
};
