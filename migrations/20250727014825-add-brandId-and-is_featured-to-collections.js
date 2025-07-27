'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    await queryInterface.addColumn('Collections', 'brandId', {
      type: Sequelize.INTEGER,
      references: {
        model: 'Brands', // name of your Brand model
        key: 'id',
      },
      onUpdate: 'CASCADE',
      onDelete: 'SET NULL',
    });

    await queryInterface.addColumn('Collections', 'is_featured', {
      type: Sequelize.BOOLEAN,
      defaultValue: false,
    });
  },

  async down (queryInterface, Sequelize) {
    await queryInterface.removeColumn('Collections', 'brandId');
    await queryInterface.removeColumn('Collections', 'is_featured');
  }
};
