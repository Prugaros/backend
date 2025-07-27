'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('products', 'brandId', {
      type: Sequelize.INTEGER,
      references: {
        model: 'Brands',
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });
    await queryInterface.removeColumn('products', 'brand');
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.addColumn('products', 'brand', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.removeColumn('products', 'brandId');
  }
};
