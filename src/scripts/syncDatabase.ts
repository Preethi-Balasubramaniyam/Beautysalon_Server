import logger from '../common/logger';
// import CallRecord from '../models/callRecord';
// import Endpoint from '../models/endpoint';
// import Message from '../models/message';
import Report from '../models/report';

async function syncDatabase() {
  try {

    // await Endpoint.sync({ alter: true });
    await Report.sync({ alter: true });

    // await Promise.all([
    //   Message.sync({ alter: true }),
    //   CallRecord.sync({ alter: true }),
    //   Post.sync({ alter: true }),
    // ]);
    
    logger.info('Database sync complete');
  } catch (error) {
    logger.error('Database sync failed:', error);
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  syncDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

export default syncDatabase;