const express = require('express');
const router = express.Router();
const uploadController = require('../controllers/upload.controller');
const multer = require('multer');
const path = require('path'); // Import path module
const fs = require('fs'); // Import file system module

// Configure multer for file storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, '..', 'public', 'uploads', 'images');
    // Ensure the upload directory exists
    fs.mkdirSync(uploadPath, { recursive: true });
    console.log('Multer destination path:', uploadPath); // Log the destination path
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB file size limit
});

// Route for uploading multiple images
router.post('/image', upload.array('images', 20), uploadController.uploadImages); // Increased to 20 files

module.exports = router;
