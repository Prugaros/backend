'use strict';
const {
  Model
} = require('sequelize');
module.exports = (sequelize, DataTypes) => {
  class Brand extends Model {
    /**
     * Helper method for defining associations.
     * This method is not a part of Sequelize lifecycle.
     * The `models/index` file will call this method automatically.
     */
    static associate(models) {
      // define association here
      Brand.hasMany(models.Collection, {
        foreignKey: 'brandId',
        as: 'collections',
      });
      Brand.hasMany(models.Product, {
        foreignKey: 'brandId',
        as: 'products',
      });
    }
  }
  Brand.init({
    name: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    displayOrder: {
      type: DataTypes.INTEGER,
      defaultValue: 0
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    }
  }, {
    sequelize,
    modelName: 'Brand',
  });
  return Brand;
};
