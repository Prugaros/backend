'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class Order extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // Order belongs to one Customer
      Order.belongsTo(models.Customer, {
        foreignKey: 'customer_id',
        as: 'customer' // Alias
      });
      // Order belongs to one GroupOrder
      Order.belongsTo(models.GroupOrder, {
        foreignKey: 'group_order_id',
        as: 'groupOrder' // Alias
      });
      // Order belongs to many Products through OrderItems
      Order.belongsToMany(models.Product, {
        through: 'OrderItem', // Name of the join table model
        foreignKey: 'order_id',
        otherKey: 'product_id',
        as: 'products' // Alias
      });
      // Order has many OrderItems (if you need direct access to join table attributes)
      Order.hasMany(models.OrderItem, {
        foreignKey: 'order_id',
        as: 'orderItems'
      });
    }
  }
  Order.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false
    },
    customer_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'customers', // Table name
        key: 'id'
      }
    },
    group_order_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'group_orders', // Table name
        key: 'id'
      }
    },
    order_date: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    total_amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true // Calculated after items are added
    },
    shipping_cost: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true // Determined later or based on rules
    },
    payment_status: {
      type: DataTypes.ENUM('Invoice Sent', 'Payment Claimed', 'Paid', 'Error', 'Cancelled'),
      allowNull: false,
      defaultValue: 'Invoice Sent'
    },
    shipping_status: {
      type: DataTypes.ENUM('Pending', 'Processing', 'Shipped', 'Delivered', 'Issue'),
      allowNull: true, // Initially null or pending
      defaultValue: 'Pending'
    },
    // Shipping Preparation Fields
    package_type: {
      type: DataTypes.ENUM('Poly Small', 'Poly Medium', 'Poly Large', 'Box 6x6x6', 'Box Custom'),
      allowNull: true
    },
    package_length: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    package_width: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    package_height: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true
    },
    total_weight_oz: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: true // Calculated based on items or set manually
    },
    // Timestamps (createdAt, updatedAt) added automatically
  }, {
    sequelize,
    modelName: 'Order',
    tableName: 'orders',
    timestamps: true,
  });
  return Order;
};
