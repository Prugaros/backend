'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('products', 'more_images', {
      type: Sequelize.TEXT,
      allowNull: true,
      defaultValue: '[]' // Store as JSON string, default to empty array
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('products', 'more_images');
  }
};
