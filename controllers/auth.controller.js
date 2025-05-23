const db = require("../models"); // Adjust path as necessary if structure changes
const AdminUser = db.AdminUser;
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");

exports.login = async (req, res) => {
  try {
    const user = await AdminUser.findOne({
      where: {
        username: req.body.username,
      },
    });

    if (!user) {
      return res.status(404).send({ message: "Admin User Not found." });
    }

    const passwordIsValid = await user.validPassword(req.body.password);

    if (!passwordIsValid) {
      return res.status(401).send({
        accessToken: null,
        message: "Invalid Password!",
      });
    }

    const token = jwt.sign({ id: user.id }, process.env.JWT_SECRET, {
      expiresIn: 86400, // 24 hours
      // algorithm: 'HS256' // Default algorithm
    });

    res.status(200).send({
      id: user.id,
      username: user.username,
      accessToken: token,
    });
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
};

// Optional: Add a signup/register function if needed later
// exports.register = async (req, res) => { ... };
