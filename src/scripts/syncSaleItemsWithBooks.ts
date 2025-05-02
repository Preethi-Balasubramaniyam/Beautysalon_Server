import { AuthClient } from '../client/utils/authClient'; // Replace with the actual package or path where AuthClient is defined
import ItemsUtils from '../client/utils/itemsUtils';
import logger from '../common/logger'; // Import the logger
import { ZohoBooksClient } from '../zohoServices/zohoBooksClient'; // Import ZohoBooksClient
import readline from 'readline';
import { SaleItemInput, SaleItemCategoryInput } from '../types/saleItemTypes'; // Import SaleItemInput and SaleItemCategoryInput
import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';


const apiClient = new AuthClient('prod');
const itemsUtils = new ItemsUtils(apiClient);



const hsnMap: Map<string, string> = new Map();

const loadHSNData = async () => {
    const csvFilePath = path.join(__dirname, '../../config/HSN_SAC_Combined.csv');
    logger.info(`Loading HSN data from ${csvFilePath}`);
    return new Promise<void>((resolve, reject) => {
        interface HSNRow {
            'HSN/SAC_CD': string;
            'HSN/SAC_Name': string;
        }

        fs.createReadStream(csvFilePath)
            .pipe(csv())
            .on('data', (row: HSNRow) => {
                const hsnCode = row['HSN/SAC_CD'];
                const description = row['HSN/SAC_Name'];
                hsnMap.set(hsnCode, description);
            })
            .on('end', () => {
                logger.info('HSN data loaded successfully');
                resolve();
            })
            .on('error', (error: Error) => {
                logger.error('Error loading HSN data:', error);
                reject(error);
            });
    });
};

const categoryCache: Map<string, string> = new Map();

const addCategory = async (category: SaleItemCategoryInput): Promise<string> => {
	logger.info(`Adding category: ${category.name}: %o`, category);
	try {
		const response = await apiClient.post('saleItems/categories', category);
		if (response.status >= 200 && response.status < 300) {
			logger.info(`Added category: ${category.name}`);
			const categoryId = response.data.id;
			categoryCache.set(category.hsnSacCode, categoryId); // Add to cache
			return categoryId;
		}
	} catch (error) {
		logger.error(`Failed to add category: ${category.name}`, error);
		throw error;
	}
	return '0';
}

const getCategoryId = async (hsnCode: string): Promise<string> => {
	logger.info(`Fetching category ID for HSN code: ${hsnCode}`);
	if (categoryCache.has(hsnCode)) {
		logger.info(`Category ID for HSN code ${hsnCode} found in cache`);
		return categoryCache.get(hsnCode) as string;
	}

	const response = await itemsUtils.getCategoryByHsnCode(hsnCode);
	if (response != null) {
		const categoryId = response.id;
		categoryCache.set(hsnCode, categoryId);
		return categoryId;
	} else {
		const categoryInput: SaleItemCategoryInput = {
			name: hsnMap.get(hsnCode) ?? hsnCode,
			description: hsnMap.get(hsnCode) ?? hsnCode,
			type: hsnMap.get(hsnCode)?.includes('HSN') ? 'product' : 'service',
			hsnSacCode: hsnCode,
			taxPercent: 18.0, // Change to float
		};
		return '0';
		//return await addCategory(categoryInput);
	}
}



const fetchAllZohoItems = async (page: number): Promise<{ items: SaleItemInput[], hasMorePages: boolean }> => {
	logger.info(`Fetching Zoho items from page ${page}`);
	try {
		const zohoBooksClient = await ZohoBooksClient.getInstance(logger, "yazz");
		const { items, page_context } = await zohoBooksClient.getRecords('items', { page });
		logger.info(`Fetched ${items.length} Zoho items from page ${page} : %o`, items);
		const processedItems: SaleItemInput[] = [];
		for (const item of items) {
			logger.info(`Processing item: ${item.name}: %o`	, item);
			if (item.status !== 'active') {
				logger.info(`Item ${item.name} is not active. Skipping`);
				continue;
			}
			if (!item.hsn_or_sac) {
				logger.error(`Item ${item.name} does not have HSN code. Skipping`);
				continue;
			}
			try {
				const processedItem: SaleItemInput = {
					name: item.name,
					rate: item.rate * 1.18,
					categoryId: await getCategoryId(item.hsn_or_sac),
					booksRefId: item.item_id,
				};
				if (processedItem.categoryId === '0') {
					logger.error(`HSN Code is not in the system ${item.name}. Skipping`);
					continue;
				}								
				processedItems.push(processedItem);
			} catch (error) {
				logger.error(`Failed to get category ID for item ${item.name}:`, error);
			}
		}
		return {
			items: processedItems,
			hasMorePages: page_context.has_more_page,
		};
	} catch (error) {
		logger.error('Error fetching all Zoho items:', error);
		throw new Error('Error fetching all Zoho items: ' + error);
	}
}

const fetchAndSyncZohoItems = async () => {
	logger.info('Starting to fetch and sync Zoho items');
	try {
		let page = 1;
		let loopMore = true;

		while (loopMore) {
			logger.info(`Fetching items from page ${page}`);
			const {items, hasMorePages} = await fetchAllZohoItems(page);
			logger.info(`Fetched ${items.length} items from page ${page}`);
			
			for (const item of items) {
				if (!item.booksRefId) {
					logger.error('Item does not have booksRefId:', item);
					throw Error('Item does not have booksRefId:');
				}
				const existingItem = await itemsUtils.getItemByName(item.name);
				if (!existingItem) {
					try {
						await itemsUtils.addItems([item]);
					} catch (error) {
						logger.error(`Failed to add item with booksRefId ${item.booksRefId}:`, error);
						continue;
					}
					logger.info(`Added item with booksRefId ${item.booksRefId}`);
				} else {
					logger.info(`Item with booksRefId ${item.booksRefId} already exists. Updating`);
					try {
						await itemsUtils.updateItem(existingItem.id, item);
					} catch (error) {
						logger.error(`Failed to update item with booksRefId ${item.booksRefId}:`, error);
						continue;
					}
				}
			}
			logger.info(`Processed Zoho items from page ${page}`);
			page++;
			loopMore = hasMorePages;
		}
	} catch (error) {
		logger.error('Error fetching & SYncing Zoho items:', error);
	}
};

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout
});

const askQuestion = (query: string): Promise<string> => {
	return new Promise(resolve => rl.question(query, resolve));
};

const main = async () => {
	logger.info('Starting main process');
	try {
		const username = await askQuestion('Enter username: ');
		const password = await askQuestion('Enter password: ');
		rl.close();
		logger.info('Logging in to API client');
		await apiClient.performLogin({username, password});
		logger.info('Loading HSN data');
		await loadHSNData(); // Load HSN data before syncing items
		logger.info('Fetching and syncing Zoho items');
		await fetchAndSyncZohoItems();
		logger.info('Process completed');
	} catch (error) {
		logger.error('An error occurred in the main process: %o', error);
	}
};

main();