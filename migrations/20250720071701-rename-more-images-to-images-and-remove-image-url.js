'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    // Add the new 'images' column
    await queryInterface.addColumn('products', 'images', {
      type: Sequelize.TEXT, // Stores JSON string of image URLs
      allowNull: true,
      defaultValue: '[]'
    });

    // Remove 'image_url' column
    await queryInterface.removeColumn('products', 'image_url');

    // Remove 'more_images' column
    await queryInterface.removeColumn('products', 'more_images');
  },

  async down (queryInterface, Sequelize) {
    // Revert: Add 'more_images' back
    await queryInterface.addColumn('products', 'more_images', {
      type: Sequelize.TEXT,
      allowNull: true,
      defaultValue: '[]'
    });

    // Revert: Add 'image_url' back
    await queryInterface.addColumn('products', 'image_url', {
      type: Sequelize.STRING,
      allowNull: true
    });

    // Revert: Remove 'images' column
    await queryInterface.removeColumn('products', 'images');
  }
};
