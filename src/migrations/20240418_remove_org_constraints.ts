import { QueryInterface } from 'sequelize';

export async function up(queryInterface: QueryInterface): Promise<void> {
  // List of tables and their foreign key constraints to remove
  const constraints = [
    { table: 'Branches', constraint: 'Branches_ibfk_1' },
    { table: 'Ledgers', constraint: 'Ledgers_ibfk_1' },
    { table: 'Endpoints', constraint: 'Endpoints_ibfk_1' },
    { table: 'SaleItems', constraint: 'SaleItems_ibfk_1' },
    { table: 'Customers', constraint: 'Customers_ibfk_1' },
    { table: 'Queues', constraint: 'Queues_ibfk_1' },
    { table: 'SaleItemCategories', constraint: 'SaleItemCategories_ibfk_1' },
    { table: 'Media', constraint: 'Media_ibfk_1' },
    { table: 'ServiceProviders', constraint: 'ServiceProviders_ibfk_1' },
    { table: 'Messages', constraint: 'Messages_ibfk_1' },
    { table: 'Events', constraint: 'Events_ibfk_1' },
    { table: 'Reactions', constraint: 'Reactions_ibfk_1' }
  ];

  // Remove each constraint
  for (const { table, constraint } of constraints) {
    try {
      console.log(`Removing constraint ${constraint} from table ${table}`);
      await queryInterface.removeConstraint(table, constraint);
      console.log(`Successfully removed constraint ${constraint} from table ${table}`);
    } catch (error) {
      // Ignore error if constraint doesn't exist
      if (!(error instanceof Error) || !error.message.includes('does not exist')) {
        console.error(`Error removing constraint ${constraint} from table ${table}:`, error);
        throw error;
      }
      console.log(`Constraint ${constraint} does not exist on table ${table}, skipping`);
    }
  }
}

export async function down(queryInterface: QueryInterface): Promise<void> {
  // List of tables and their foreign key constraints to recreate
  const constraints = [
    { table: 'Branches', constraint: 'Branches_ibfk_1', field: 'orgId' },
    { table: 'Ledgers', constraint: 'Ledgers_ibfk_1', field: 'orgId' },
    { table: 'Endpoints', constraint: 'Endpoints_ibfk_1', field: 'orgId' },
    { table: 'SaleItems', constraint: 'SaleItems_ibfk_1', field: 'orgId' },
    { table: 'Customers', constraint: 'Customers_ibfk_1', field: 'orgId' },
    { table: 'Queues', constraint: 'Queues_ibfk_1', field: 'orgId' },
    { table: 'SaleItemCategories', constraint: 'SaleItemCategories_ibfk_1', field: 'orgId' },
    { table: 'Media', constraint: 'Media_ibfk_1', field: 'orgId' },
    { table: 'ServiceProviders', constraint: 'ServiceProviders_ibfk_1', field: 'orgId' },
    { table: 'Messages', constraint: 'Messages_ibfk_1', field: 'orgId' },
    { table: 'Events', constraint: 'Events_ibfk_1', field: 'orgId' },
    { table: 'Reactions', constraint: 'Reactions_ibfk_1', field: 'orgId' }
  ];

  // Recreate each constraint
  for (const { table, constraint, field } of constraints) {
    try {
      console.log(`Recreating constraint ${constraint} on table ${table}`);
      await queryInterface.addConstraint(table, {
        fields: [field],
        type: 'foreign key',
        name: constraint,
        references: {
          table: 'Orgs',
          field: 'id'
        },
        onDelete: 'CASCADE',
        onUpdate: 'CASCADE'
      });
      console.log(`Successfully recreated constraint ${constraint} on table ${table}`);
    } catch (error) {
      console.error(`Error recreating constraint ${constraint} on table ${table}:`, error);
      throw error;
    }
  }
} 