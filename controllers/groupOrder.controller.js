const db = require("../models");
const Customer = db.Customer;
const GroupOrder = db.GroupOrder;
const Product = db.Product; // Needed for associating products
const Collection = db.Collection; // Needed for checking featured status
const GroupOrderItem = db.GroupOrderItem; // Needed for managing associations
const { Op } = require("sequelize");
const axios = require('axios'); // For making HTTP requests (e.g., to Facebook API)
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

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
    custom_message: req.body.custom_message || null,
    // facebook_post_id will be set later when 'started'
  };

  try {
    const groupOrder = await GroupOrder.create(groupOrderData);

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
    const data = await GroupOrder.findByPk(id);
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

  try {
    // Update basic GroupOrder fields
    const [num] = await GroupOrder.update(req.body, { where: { id: id } });

    if (num !== 1) {
      return res.status(404).send({ message: `Cannot update Group Order with id=${id}. Maybe it was not found.` });
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
  const { postToFacebook } = req.body; // Get the flag from the request body

  try {
    const groupOrder = await GroupOrder.findByPk(id);
    if (!groupOrder) {
      return res.status(404).send({ message: `Group Order with id=${id} not found.` });
    }
    if (groupOrder.status !== 'Draft') {
      return res.status(400).send({ message: `Group Order is not in Draft status.` });
    }

    let facebookPostId = null;

    // Only attempt to post if the flag is explicitly true
    if (postToFacebook === true) {
      try {
        const pageId = process.env.FACEBOOK_PAGE_ID;
        const accessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

        if (!pageId || !accessToken) {
          console.warn("Facebook Page ID or Access Token missing. Skipping post.");
        } else {
          const products = await Product.findAll({
            where: { is_active: true },
            include: [{
              model: Collection,
              as: 'collection',
              attributes: ['id', 'name', 'displayOrder', 'is_featured']
            }],
            order: [
              [{ model: Collection, as: 'collection' }, 'displayOrder', 'ASC'],
              ['collectionProductOrder', 'ASC']
            ]
          });

          // Filter for featured products and products in featured collections
          const featuredProducts = products.filter(p => p.is_featured || (p.collection && p.collection.is_featured));

          // 1. Format the post message
          let postMessage = `${groupOrder.start_date.toLocaleDateString()}–${groupOrder.end_date.toLocaleDateString()} GROUP ORDER NOW OPEN\n\n`;
          postMessage += `${groupOrder.custom_message}\n\n`;

          // Add Messenger link. The `ref` parameter has proven unreliable.
          // Now that we rely on the Persistent Menu, we just link to the bot.
          const pageUsername = process.env.FACEBOOK_PAGE_USERNAME;
          const messengerLink = `http://m.me/${pageUsername}`;
          postMessage += `\n\nTo order, click here and hit send: ${messengerLink}`;

          // 2. Select and prepare images for upload
          const imagesToUpload = featuredProducts;

          const uploadedPhotoIds = [];
          if (imagesToUpload.length > 0) {
            console.log(`Attempting to upload ${imagesToUpload.length} images...`);
            const uploadPromises = imagesToUpload.map(async (product) => {
              if (product.images && product.images.length > 0) {
                const imageName = product.images[0];
                const cleanImageName = imageName.split(/[\\/]/).pop();
                const imagePath = path.join(__dirname, '..', 'public', 'uploads', 'images', cleanImageName);

                if (fs.existsSync(imagePath)) {
                  const form = new FormData();
                  form.append('source', fs.createReadStream(imagePath));
                  form.append('caption', product.name);
                  form.append('published', 'false');
                  form.append('access_token', accessToken);

                  try {
                    const response = await axios.post(`https://graph.facebook.com/v25.0/${pageId}/photos`, form, {
                      headers: form.getHeaders()
                    });
                    if (response.data && response.data.id) {
                      console.log(`Successfully uploaded image ${cleanImageName}, Photo ID: ${response.data.id}`);
                      return { media_fbid: response.data.id };
                    }
                  } catch (uploadError) {
                    console.error(`Failed to upload image ${cleanImageName}:`, uploadError.response?.data || uploadError.message);
                    return null;
                  }
                } else {
                  console.warn(`Image file not found, skipping: ${imagePath}`);
                  return null;
                }
              }
              return null;
            });

            const results = await Promise.all(uploadPromises);
            uploadedPhotoIds.push(...results.filter(r => r !== null));
          }

          // 3. Make the API Call to create the post
          const graphApiUrl = `https://graph.facebook.com/v25.0/${pageId}/feed`;
          let postData = {
            message: postMessage,
            access_token: accessToken,
          };

          if (uploadedPhotoIds.length > 0) {
            postData.attached_media = uploadedPhotoIds;
          }

          console.log("Attempting to post to Facebook with data:", postData);
          const response = await axios.post(graphApiUrl, postData, {
            headers: { 'Content-Type': 'application/json' }
          });

          if (response.data && response.data.id) {
            facebookPostId = response.data.id;
            console.log("Successfully posted to Facebook. Post ID:", facebookPostId);
          } else {
            console.error("Failed to post to Facebook or get post ID:", response.data);
          }
        }
      } catch (fbError) {
        console.error("Error during Facebook post attempt:", fbError.response?.data || fbError.message);
        // Do not block the order from starting if FB post fails
      }
    } else {
      console.log(`Skipping Facebook post for Group Order ${id} as requested.`);
    }

    // --- Update DB Status ---
    groupOrder.status = 'Active';
    groupOrder.facebook_post_id = facebookPostId;
    groupOrder.start_date = new Date();
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

    // Reset conversation state for all customers in this group order
    const allCustomers = await Customer.findAll();
    const customersToReset = allCustomers.filter(c => c.conversation_data && c.conversation_data.groupOrderId === groupOrder.id);

    for (const customer of customersToReset) {
      customer.conversation_state = 'INITIAL';
      customer.conversation_data = {};
      await customer.save();
    }

    res.send({ message: "Group Order closed successfully." });

  } catch (err) {
    res.status(500).send({ message: "Error closing Group Order with id=" + id + ": " + err.message });
  }
};

// Reactivate a Group Order (Set status to Active)
exports.reactivateOrder = async (req, res) => {
  const id = req.params.id;
  try {
    const groupOrder = await GroupOrder.findByPk(id);
    if (!groupOrder) {
      return res.status(404).send({ message: `Group Order with id=${id} not found.` });
    }
    if (groupOrder.status !== 'Closed') {
      return res.status(400).send({ message: `Group Order is not Closed.` });
    }

    groupOrder.status = 'Active';
    await groupOrder.save();

    res.send({ message: "Group Order reactivated successfully." });

  } catch (err) {
    res.status(500).send({ message: "Error reactivating Group Order with id=" + id + ": " + err.message });
  }
};
