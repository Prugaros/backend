'use strict';
const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  class StoreCredit extends Model {
    static associate(models) {
      StoreCredit.belongsTo(models.Customer, {
        foreignKey: 'customer_id',
        as: 'customer'
      });
      StoreCredit.belongsTo(models.AdminUser, {
        foreignKey: 'admin_user_id',
        as: 'adminUser'
      });
    }
  }
  StoreCredit.init({
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
        model: 'customers',
        key: 'id'
      }
    },
    amount: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    reason: {
      type: DataTypes.STRING,
      allowNull: true
    },
    admin_user_id: {
      type: DataTypes.INTEGER,
      allowNull: false,
      references: {
        model: 'admin_users',
        key: 'id'
      }
    }
  }, {
    sequelize,
    modelName: 'StoreCredit',
    tableName: 'store_credits',
    timestamps: true,
  });
  return StoreCredit;
};
