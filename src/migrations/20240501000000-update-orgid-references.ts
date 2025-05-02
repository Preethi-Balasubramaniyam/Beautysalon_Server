import { QueryInterface, Sequelize } from 'sequelize';

const tablesWithOrgId = [
  'Users',
  'Branches',
  'Customers',
  'ServiceProviders',
  'Ledgers',
  'Endpoints',
  'Events',
  'Invoices',
  'Messages',
  'Media',
  'SaleItems',
  'Offers',
  'Posts',
  'Queues',
  'CallRecords',
  'CustomerPayments',
];

interface OrgMapping {
  newId: string;
  name: string;
}

/**
 * Migration to update orgId references to match org names
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function up(queryInterface: QueryInterface, _sequelize: Sequelize): Promise<void> {
  console.log('Starting migration to update orgId references to match org names');

  // Start a transaction for the entire migration
  const transaction = await queryInterface.sequelize.transaction();
  
  try {
    // First, get the mapping of org names to their IDs
    console.log('Retrieving org mappings');
    const [orgRows] = await queryInterface.sequelize.query(`
      SELECT id as newId, name 
      FROM Orgs
    `, { transaction });

    const orgMappings: OrgMapping[] = orgRows as OrgMapping[];
    
    if (orgMappings.length === 0) {
      console.log('No organizations found to process');
      await transaction.commit();
      return;
    }

    console.log(`Found ${orgMappings.length} organizations to process`);

    // Process each table
    for (const table of tablesWithOrgId) {
      console.log(`Checking if table ${table} exists and has orgId column`);
      
      // Check if the table exists
      const [tableCheck] = await queryInterface.sequelize.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = DATABASE() 
        AND table_name = '${table}'
      `, { transaction });
      
      if (Array.isArray(tableCheck) && tableCheck.length === 0) {
        console.log(`Table ${table} does not exist, skipping`);
        continue;
      }
      
      // Check if the orgId column exists in this table
      const [columnCheck] = await queryInterface.sequelize.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = DATABASE() 
        AND table_name = '${table}' 
        AND column_name = 'orgId'
      `, { transaction });
      
      if (Array.isArray(columnCheck) && columnCheck.length === 0) {
        console.log(`Table ${table} does not have an orgId column, skipping`);
        continue;
      }

      console.log(`Updating ${table} table orgId references`);
      
      // Special handling for Endpoints table to avoid duplicate key errors
      if (table === 'Endpoints') {
        console.log('Using special handling for Endpoints table to avoid duplicate key errors');
        
        for (const org of orgMappings) {
          console.log(`Processing Endpoints for org ${org.name} (ID: ${org.newId})`);
          
          // Get all endpoints with this org name
          const [endpoints] = await queryInterface.sequelize.query(`
            SELECT id FROM ${table} 
            WHERE orgId = :name
          `, {
            replacements: { name: org.name },
            transaction
          });
          
          let updatedCount = 0;
          let skippedCount = 0;
          
          // Update each endpoint individually
          if (Array.isArray(endpoints) && endpoints.length > 0) {
            for (const endpoint of endpoints as { id: string }[]) {
              try {
                // Try to update this specific endpoint
                await queryInterface.sequelize.query(`
                  UPDATE ${table}
                  SET orgId = :newId
                  WHERE id = :id
                `, {
                  replacements: { 
                    newId: org.newId,
                    id: endpoint.id
                  },
                  transaction
                });
                updatedCount++;
              } catch (err: unknown) {
                // Log the error but continue with other records
                const errorMessage = err instanceof Error ? err.message : String(err);
                console.log(`Skipped updating endpoint ID ${endpoint.id} due to constraint error: ${errorMessage}`);
                skippedCount++;
              }
            }
          }
          
          console.log(`Updated ${updatedCount} Endpoints records for org ${org.name}, skipped ${skippedCount} due to constraints`);
          
          // Do the same for non-UUID format orgIds
          const [oldFormatEndpoints] = await queryInterface.sequelize.query(`
            SELECT id FROM ${table}
            WHERE orgId NOT LIKE '%-%-%-%-%' 
            AND orgId != :newId
            AND LOWER(orgId) = LOWER(:name)
          `, {
            replacements: { 
              newId: org.newId,
              name: org.name
            },
            transaction
          });
          
          let oldFormatUpdatedCount = 0;
          let oldFormatSkippedCount = 0;
          
          if (Array.isArray(oldFormatEndpoints) && oldFormatEndpoints.length > 0) {
            for (const endpoint of oldFormatEndpoints as { id: string }[]) {
              try {
                await queryInterface.sequelize.query(`
                  UPDATE ${table}
                  SET orgId = :newId
                  WHERE id = :id
                `, {
                  replacements: { 
                    newId: org.newId,
                    id: endpoint.id
                  },
                  transaction
                });
                oldFormatUpdatedCount++;
              } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                console.log(`Skipped updating old-format endpoint ID ${endpoint.id} due to constraint error: ${errorMessage}`);
                oldFormatSkippedCount++;
              }
            }
          }
          
          console.log(`Updated ${oldFormatUpdatedCount} additional old-format Endpoints records for org ${org.name}, skipped ${oldFormatSkippedCount} due to constraints`);
        }
      } else {
        // For tables other than Endpoints, use the original approach
        for (const org of orgMappings) {
          console.log(`Updating ${table} records for org ${org.name} (ID: ${org.newId})`);
          
          // Update records where orgId matches the org name directly
          const [result1] = await queryInterface.sequelize.query(`
            UPDATE ${table}
            SET orgId = :newId
            WHERE orgId = :name
          `, {
            replacements: { 
              newId: org.newId,
              name: org.name 
            },
            transaction
          });
          
          console.log(`Updated ${JSON.stringify(result1)} records in ${table} for org name ${org.name}`);

          // Update records where orgId is a string that doesn't match the UUID format
          // This handles old orgIds that may still be strings like "org123"
          const [result2] = await queryInterface.sequelize.query(`
            UPDATE ${table}
            SET orgId = :newId
            WHERE orgId NOT LIKE '%-%-%-%-%' 
            AND orgId != :newId
            AND LOWER(orgId) = LOWER(:name)
          `, {
            replacements: { 
              newId: org.newId,
              name: org.name
            },
            transaction
          });
          
          console.log(`Updated ${JSON.stringify(result2)} additional records with non-UUID orgIds in ${table} for org ${org.name}`);
        }
      }
    }

    // If we reach this point, commit the transaction
    await transaction.commit();
    console.log('Migration completed successfully and changes committed');
  } catch (err: unknown) {
    // Rollback the transaction if any error occurs
    await transaction.rollback();
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error('Error during migration, all changes rolled back:', errorMessage);
    throw err;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function down(_queryInterface: QueryInterface, _Sequelize: Sequelize): Promise<void> {
  console.log('This migration cannot be safely reversed as it modifies data based on org names');
  return Promise.resolve();
}

// For Sequelize CLI compatibility
module.exports = { up, down }; 