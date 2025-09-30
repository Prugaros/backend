'use strict';

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.addColumn('customers', 'destash_conversation_state', {
      type: Sequelize.STRING,
      allowNull: true,
    });
    await queryInterface.addColumn('customers', 'destash_conversation_data', {
      type: Sequelize.TEXT,
      allowNull: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeColumn('customers', 'destash_conversation_state');
    await queryInterface.removeColumn('customers', 'destash_conversation_data');
  }
};
