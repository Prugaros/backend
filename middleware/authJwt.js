const jwt = require("jsonwebtoken");
const db = require("../models"); // Adjust path if needed
const AdminUser = db.AdminUser;

const verifyToken = (req, res, next) => {
  let token = req.headers["x-access-token"] || req.headers["authorization"]; // Check common headers

  if (!token) {
    return res.status(403).send({
      message: "No token provided!",
    });
  }

  // If token is in 'Bearer <token>' format, extract the token part
  if (token.startsWith('Bearer ')) {
    token = token.slice(7, token.length);
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      // Handle specific errors like token expiration
      if (err.name === 'TokenExpiredError') {
        return res.status(401).send({
          message: "Unauthorized! Access Token was expired!",
        });
      }
      // Handle other verification errors
      return res.status(401).send({
        message: "Unauthorized! Invalid Token.",
      });
    }
    // If token is valid, save the decoded user ID to the request object
    req.userId = decoded.id;
    next(); // Proceed to the next middleware or route handler
  });
};

// Optional: Middleware to check if the user found by token actually exists
// This adds an extra DB check but ensures the user hasn't been deleted since token issuance
const ensureUserExists = async (req, res, next) => {
    if (!req.userId) {
        // This should ideally not happen if verifyToken ran first, but good practice
        return res.status(403).send({ message: "User ID not found in token." });
    }
    try {
        const user = await AdminUser.findByPk(req.userId);
        if (!user) {
            return res.status(404).send({ message: "Admin user associated with token not found." });
        }
        // Optionally attach user object to request if needed downstream
        // req.user = user;
        next();
    } catch (error) {
        return res.status(500).send({ message: "Error verifying user existence." });
    }
};


const isAdmin = async (req, res, next) => {
    try {
        const user = await AdminUser.findByPk(req.userId);
        if (user && user.role === 'admin') { // Assuming 'role' is a field in your AdminUser model
            next();
        } else {
            res.status(403).send({
                message: "Require Admin Role!"
            });
        }
    } catch (error) {
        res.status(500).send({
            message: "Unable to validate User role!"
        });
    }
};

const authJwt = {
  verifyToken: verifyToken,
  ensureUserExists: ensureUserExists, // Export the existence check as well
  isAdmin: isAdmin
};

module.exports = authJwt;
