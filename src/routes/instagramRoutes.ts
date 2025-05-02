import express from 'express';
import { MessageServicesManager } from '../services/messaging/messageServiceManager';
import logger from '../common/logger';
import { Channel } from '../types/commTypes';

const router = express.Router();

router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token === 'instagramVerifyTokenDoNotShare') {
    logger.info('Instagram webhook verified');
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});


router.post('/webhook', async (req, res) => {
  try {
    console.log(req.body);
    const orgId = '6843b2eb-caf2-4689-94f9-458e6f8691ac'; 
    const manager = MessageServicesManager.getInstance();
    const processor = await manager.getMessageProcessor(orgId);

    const instagramService = processor.getMessagingService(Channel.instagram); 

    if (!instagramService) {
      throw new Error('Instagram service not initialized for org ' + orgId);
    }
    console.log(req.body);
    //await instagramService.processInstagramMessage(req.body);
    res.sendStatus(200);
  } catch (error) {
    logger.error('Instagram webhook error:', error);
    res.sendStatus(500);
  }
});

export default router;
