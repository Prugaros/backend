'use strict';
const { Model } = require('sequelize');
const bcrypt = require('bcrypt');

module.exports = (sequelize, DataTypes) => {
  class AdminUser extends Model {
    // Method to check password validity
    async validPassword(password) {
      return await bcrypt.compare(password, this.password_hash);
    }

    // Define associations here if needed (e.g., if admin users create group orders)
    static associate(models) {
      // define association here
      // Example: AdminUser.hasMany(models.GroupOrder, { foreignKey: 'created_by_admin_id' });
    }
  }
  AdminUser.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false
    },
    username: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    password_hash: {
      type: DataTypes.STRING,
      allowNull: false
    }
    // Timestamps (createdAt, updatedAt) are added automatically by Sequelize
  }, {
    sequelize,
    modelName: 'AdminUser',
    tableName: 'admin_users', // Optional: Explicitly define table name
    timestamps: true, // Enable timestamps
    hooks: {
      // Hash password before creating/updating user
      beforeSave: async (user, options) => {
        if (user.changed('password_hash')) { // Only hash if the password field itself is being set/changed
          const salt = await bcrypt.genSalt(10);
          user.password_hash = await bcrypt.hash(user.password_hash, salt);
        }
      },
      // You might use beforeUpdate hook similarly if you allow password changes
      // via setting the password_hash field directly (though usually you'd have a separate password change logic)
    }
  });

  // Add instance method to handle password setting and hashing
  // This allows setting user.password = 'newpass' and having it hashed automatically
  // Note: We named the DB field password_hash, so this virtual setter is for convenience
  AdminUser.prototype.setPassword = async function(password) {
      const salt = await bcrypt.genSalt(10);
      this.password_hash = await bcrypt.hash(password, salt);
  };


  return AdminUser;
};
