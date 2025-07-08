'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
    /**
     * Add altering commands here.
     *
     * Example:
     * await queryInterface.createTable('users', { id: Sequelize.INTEGER });
     */
    await queryInterface.removeColumn('Products', 'Collection');
    await queryInterface.addColumn('Products', 'collectionId', {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: 'Collections',
        key: 'id'
      }
    });
  },

  async down (queryInterface, Sequelize) {
    /**
     * Add reverting commands here.
     *
     * Example:
     * await queryInterface.dropTable('users');
     */
    await queryInterface.addColumn('Products', 'Collection', {
      type: Sequelize.STRING,
      allowNull: true
    });
    await queryInterface.removeColumn('Products', 'collectionId');
  }
};
