'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Customer extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // Customer has many Orders
      Customer.hasMany(models.Order, {
        foreignKey: 'customer_id',
        as: 'orders' // Alias for the association
      });
      Customer.hasMany(models.StoreCredit, {
        foreignKey: 'customer_id',
        as: 'storeCredits'
      });
    }
  }
  Customer.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false
    },
    facebook_psid: { // Page-Scoped ID from Facebook Messenger
      type: DataTypes.STRING,
      allowNull: false,
      unique: true // PSID should be unique per page
    },
    name: {
      type: DataTypes.STRING,
      allowNull: true // May not get name initially
    },
    email: {
      type: DataTypes.STRING,
      allowNull: true,
      validate: {
        isEmail: true // Optional: Validate email format
      }
    },
    street_address: {
      type: DataTypes.STRING,
      allowNull: true
    },
    city: {
      type: DataTypes.STRING,
      allowNull: true
    },
    state: { // Consider standardizing (e.g., 2-letter code)
      type: DataTypes.STRING,
      allowNull: true
    },
    zip: { // Postal code
      type: DataTypes.STRING,
      allowNull: true
    },
    country: {
      type: DataTypes.STRING,
      allowNull: true
    },
    // New fields for conversation state
    conversation_state: {
        type: DataTypes.STRING,
        allowNull: true, // Can be null if no active conversation
        defaultValue: 'INITIAL'
    },
    conversation_data: {
        type: DataTypes.TEXT, // Use TEXT for potentially larger JSON strings
        allowNull: true,
        get() {
            const rawValue = this.getDataValue('conversation_data');
            // Ensure we always return an object, even if DB value is null/empty
            try {
                return rawValue ? JSON.parse(rawValue) : {};
            } catch (e) {
                console.error("Error parsing conversation_data:", e);
                return {}; // Return empty object on parse error
            }
        },
        set(value) {
            // Ensure we store null if value is null/undefined/empty object
            if (value === null || value === undefined || (typeof value === 'object' && Object.keys(value).length === 0)) {
                 this.setDataValue('conversation_data', null);
            } else {
                 this.setDataValue('conversation_data', JSON.stringify(value));
            }
        }
    },
    is_international: { // Added for international addresses
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false
    },
    international_address_block: { // Added for international addresses
        type: DataTypes.TEXT,
        allowNull: true
    },
    credit: {
        type: DataTypes.DECIMAL(10, 2),
        allowNull: false,
        defaultValue: 0.00
    }
    // Timestamps (createdAt, updatedAt) added automatically
  }, {
    sequelize,
    modelName: 'Customer',
    tableName: 'customers',
    timestamps: true,
  });
  return Customer;
};
