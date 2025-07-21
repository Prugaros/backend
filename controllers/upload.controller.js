const path = require('path');

// Controller function to handle image uploads
exports.uploadImages = (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).send('No files uploaded.');
  }

  const imageUrls = req.files.map(file => {
    // Construct the URL based on how Express serves static files
    // Assuming 'public' is served as root, and images are in 'public/uploads/images'
    return `/uploads/images/${file.filename}`;
  });

  res.status(200).json({
    message: 'Images uploaded successfully!',
    imageUrls: imageUrls
  });
};
