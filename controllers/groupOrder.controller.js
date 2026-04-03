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
const { callSendAPI } = require("../utils/facebookApi");
const { sendTransactionalEmail, sendBroadcastEmail } = require('../utils/emailService');

const formatSmartDate = (date, includeYear = true) => {
  if (!date) return "??/??";
  const d = new Date(date);
  // Check if it's exactly midnight UTC (standard for date pickers)
  const isMidnightUTC =
    d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;

  if (isMidnightUTC) {
    const month = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const year = d.getUTCFullYear();
    return includeYear ? `${month}/${day}/${year}` : `${month}/${day}`;
  } else {
    const month = d.getMonth() + 1;
    const day = d.getDate();
    const year = d.getFullYear();
    return includeYear ? `${month}/${day}/${year}` : `${month}/${day}`;
  }
};

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
    email_custom_message: req.body.email_custom_message || null,
    facebook_image_url: req.body.facebook_image_url || null,
    email_image_url: req.body.email_image_url || null,
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

          let postMessage = `${formatSmartDate(groupOrder.start_date)}–${formatSmartDate(groupOrder.end_date)} GROUP ORDER NOW OPEN\n\n`;
          postMessage += `${groupOrder.custom_message}\n\n`;

          // Add Messenger link. The `ref` parameter has proven unreliable.
          // Now that we rely on the Persistent Menu, we just link to the bot.
          const pageUsername = process.env.FACEBOOK_PAGE_USERNAME;
          const messengerLink = `http://m.me/${pageUsername}`;
          postMessage += `\n\nTo order, click here and hit send: ${messengerLink}`;

          // 2. Select and prepare images for upload
          let imagesToUpload = featuredProducts;
          if (groupOrder.facebook_image_url) {
            imagesToUpload = [{
              name: groupOrder.name,
              images: [groupOrder.facebook_image_url]
            }];
          }

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

    // --- Respond immediately so the admin isn't blocked ---
    res.send({ message: "Group Order started successfully.", facebookPostId: facebookPostId });

    // --- Send Notifications to All Eligible Customers (background task) ---
    (async () => {
      const emailBatchSize = parseInt(process.env.EMAIL_BATCH_SIZE || '50', 10);
      const emailBatchDelayMs = parseInt(process.env.EMAIL_BATCH_DELAY_MS || '3600000', 10);

      try {
        const customersToNotify = await Customer.findAll({
          where: {
            disable_grouporder_notification: false,
            facebook_psid: { [Op.not]: null }
          }
        });

        if (customersToNotify.length === 0) return;

        console.log(`[NOTIF] Notifying ${customersToNotify.length} customers. Email batch size: ${emailBatchSize}, delay: ${emailBatchDelayMs / 60000} min`);

        const frontendBaseUrl = process.env.FRONTEND_URL;
        let featuredImageUrl = "https://via.placeholder.com/300x200?text=Select+Items";

        if (groupOrder.email_image_url) {
          const cleanImageName = groupOrder.email_image_url.split(/[\\/]/).pop();
          featuredImageUrl = groupOrder.email_image_url.startsWith('http') ? groupOrder.email_image_url : `${process.env.BACKEND_URL}/uploads/images/${cleanImageName}`;
        } else {
          try {
            const featuredCollections = await db.Collection.findAll({
              where: { is_featured: true, isActive: true, '$brand.isActive$': true },
              include: [
                { model: db.Product, as: 'products', where: { is_active: true }, required: false },
                { model: db.Brand, as: 'brand', attributes: ['name', 'isActive'], where: { isActive: true } }
              ],
              order: [['displayOrder', 'ASC']]
            });
            const firstCollectionWithProducts = featuredCollections.find(c => c.products && c.products.length > 0);
            if (firstCollectionWithProducts) {
              const firstProduct = firstCollectionWithProducts.products[0];
              if (firstProduct && firstProduct.images && firstProduct.images.length > 0) {
                featuredImageUrl = firstProduct.images[0].startsWith('http') ? firstProduct.images[0] : `${process.env.BACKEND_URL}/${firstProduct.images[0]}`;
              }
            }
          } catch (imgErr) {
            console.error("[NOTIF] Error fetching featured image:", imgErr);
          }
        }

        const formatDate = (date) => {
          if (!date) return "??/??";
          const d = new Date(date);
          return `${(d.getMonth() + 1).toString().padStart(1, '0')}/${d.getDate().toString().padStart(1, '0')}`;
        };

        const dateRangeTitle = `${formatDate(groupOrder.start_date)} - ${formatSmartDate(groupOrder.end_date, false)} Group Order Now Open!`;

        // ── Phase 1: Messenger notifications (one per customer, 100ms apart) ──────
        for (const customer of customersToNotify) {
          try {
            const webviewUrl = `${frontendBaseUrl}/messenger-order?psid=${encodeURIComponent(customer.facebook_psid)}`;
            const notificationPayload = {
              attachment: {
                type: "template",
                payload: {
                  template_type: "generic",
                  elements: [{
                    title: dateRangeTitle,
                    image_url: featuredImageUrl,
                    subtitle: "A new Japan group order is open. Click below to start shopping.",
                    default_action: { type: "web_url", url: webviewUrl, webview_height_ratio: "full", messenger_extensions: false },
                    buttons: [{ type: "web_url", url: webviewUrl, title: "Shop Now", webview_height_ratio: "full", messenger_extensions: false }]
                  }]
                }
              }
            };
            await callSendAPI(customer.facebook_psid, notificationPayload, 'POST_PURCHASE_UPDATE');
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (notifErr) {
            console.error(`[NOTIF] Messenger notification failed for customer ${customer.id}:`, notifErr.message);
          }
        }

        // ── Phase 2: Bulk email batches (EMAIL_BATCH_SIZE per API call) ───────────
        const customersWithEmail = customersToNotify.filter(c => c.email);
        console.log(`[EMAIL] ${customersWithEmail.length} customers have email addresses. Sending in batches of ${emailBatchSize}.`);

        for (let i = 0; i < customersWithEmail.length; i += emailBatchSize) {
          const batch = customersWithEmail.slice(i, i + emailBatchSize);
          const batchNum = Math.floor(i / emailBatchSize) + 1;
          const totalBatches = Math.ceil(customersWithEmail.length / emailBatchSize);

          try {
            const backendBaseUrl = process.env.BACKEND_URL || 'http://localhost:3001';
            const recipients = batch.map(c => ({
              to: c.email,
              name: c.name,
              shopUrl: `${frontendBaseUrl}/messenger-order?psid=${encodeURIComponent(c.facebook_psid)}`,
              unsubscribeUrl: `${backendBaseUrl}/api/customers/unsubscribe/grouporder/${encodeURIComponent(c.facebook_psid)}`
            }));

            await sendBroadcastEmail('GROUP_ORDER_OPEN', recipients, {
              groupOrderName: groupOrder.name,
              dateRangeTitle,
              emailCustomMessage: groupOrder.email_custom_message,
              featuredImageUrl
            });

            console.log(`[EMAIL] Batch ${batchNum}/${totalBatches} sent (${batch.length} emails).`);
          } catch (batchErr) {
            console.error(`[EMAIL] Batch ${batchNum}/${totalBatches} failed:`, batchErr.message);
          }

          // Wait between batches (skip delay after the final batch)
          if (i + emailBatchSize < customersWithEmail.length) {
            console.log(`[EMAIL] Waiting ${emailBatchDelayMs / 60000} min before next batch...`);
            await new Promise(resolve => setTimeout(resolve, emailBatchDelayMs));
          }
        }

        console.log('[NOTIF] Group Order notification run complete.');
      } catch (notifFlowErr) {
        console.error("[NOTIF] Error in notification flow:", notifFlowErr);
      }
    })();

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
