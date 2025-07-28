'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class GroupOrder extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // GroupOrder belongs to many Products through GroupOrderItems
      GroupOrder.belongsToMany(models.Product, {
        through: 'GroupOrderItem', // Name of the join table model
        foreignKey: 'group_order_id',
        otherKey: 'product_id',
        as: 'products' // Alias for the association
      });
      // GroupOrder has many Orders
      GroupOrder.hasMany(models.Order, {
        foreignKey: 'group_order_id',
        as: 'orders' // Alias for the association
      });
      // Optional: Associate with AdminUser if tracking who created it
      // GroupOrder.belongsTo(models.AdminUser, { foreignKey: 'created_by_admin_id', as: 'creator' });
    }
  }
  GroupOrder.init({
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      comment: 'e.g., April 2025 Nail Order'
    },
    start_date: {
      type: DataTypes.DATE,
      allowNull: true // Can be null if in draft status
    },
    end_date: {
      type: DataTypes.DATE,
      allowNull: true // Can be null if indefinite or draft
    },
    status: {
      type: DataTypes.ENUM('Draft', 'Active', 'Closed'),
      allowNull: false,
      defaultValue: 'Draft'
    },
    facebook_post_id: {
      type: DataTypes.STRING,
      allowNull: true,
      comment: 'ID of the announcement post on Facebook'
    },
    custom_message: {
      type: DataTypes.TEXT,
      allowNull: true
    }
    // Optional: created_by_admin_id (INTEGER, foreign key to AdminUser)
    // Timestamps (createdAt, updatedAt) added automatically
  }, {
    sequelize,
    modelName: 'GroupOrder',
    tableName: 'group_orders',
    timestamps: true,
  });
  return GroupOrder;
};
