import { SaleItemInput, SaleItem, SaleItemCategory } from '../../types/saleItemTypes';
import { AuthClient } from './authClient'; // Replace with the actual package or path where AuthClient is defined
import logger from '../../common/logger'; // Import the logger
import c from 'config';

class ItemsUtils {
	private apiClient: AuthClient;

	constructor(apiClient: AuthClient) {
		this.apiClient = apiClient;
	}

	async addItems(items: SaleItemInput[]): Promise<void> {
		for (const item of items) {
			try {
				const response = await this.apiClient.post('saleItems', item);
				if (response.status >= 200 && response.status < 300) {
					logger.info(`Added item: [${item.name}, ${item.rate}, ${item.name}]`);
				}
			} catch (error) {
				logger.error(`Failed to add item: [${item.name}, ${item.rate}, ${item.name}]: %o Message: ${(error as any).response?.statusText}`, (error as any).response.data.errors);
				throw error;
			}
		}
	}

	async getItems(): Promise<SaleItem[]> {
		try {
			const response = await this.apiClient.get('saleItems');
			if (response.status >= 200 && response.status < 300) {
				let itemList = (response.data as { saleItems: SaleItem[] }).saleItems;
				logger.info(`Items: ${itemList.length}, Total: ${response.data.totalItems}`);
				return itemList;
			}
			throw new Error('Error fetching items');
		} catch (error) {
			logger.error('Error fetching items: %o', error);
			throw error;
		}

	}

	async updateItem(itemId: string, updatedData: any): Promise<SaleItem> {
		try {
			const response = await this.apiClient.put(`saleItems/${itemId}`, updatedData);
			if (response.status >= 200 && response.status < 300) {
				logger.info('Updated item:');
				return response.data.saleItem;
			}
			throw new Error('Error updating item');
		} catch (error) {
			logger.error('Error updating item: %o', error);
			throw error;
		}
	}

	async deleteItem(itemId: string): Promise<void> {
		try {
			const response = await this.apiClient.delete(`saleItems/${itemId}`);
			if (response.status >= 200 && response.status < 300) {
				logger.info('Deleted item:');
			}
		} catch (error) {
			logger.error('Error deleting item: %o', error);
			throw error;
		}
	}

	async getItemByName(name: string): Promise<SaleItem | null> {
		try {
			const response = await this.apiClient.get(`saleItems?name=${name}`);
			if (response.status >= 200 && response.status < 300) {
				const items = response.data.saleItems;
				if (items.length > 0) {
					return items[0];
				}
				return null;
			}
		} catch (error) {
			logger.error('Error fetching item by name: %o', error);
			throw error;
		}
		return null;
	}

	async createCategory(categoryData: any): Promise<any> {
		try {
			const response = await this.apiClient.post('saleItemcategories', categoryData);
			if (response.status >= 200 && response.status < 300) {
				logger.info(`Created category: ${categoryData.name}`);
				return response.data;
			}
		} catch (error) {
			logger.error('Error creating category: %o', error);
			throw error;
		}
	}

	async updateCategory(categoryId: string, updatedData: any): Promise<any> {
		try {
			const response = await this.apiClient.put(`saleItemcategories/${categoryId}`, updatedData);
			if (response.status >= 200 && response.status < 300) {
				logger.info(`Updated category: ${updatedData.name}`);
				return response.data;
			}
		} catch (error) {
			logger.error('Error updating category: %o', error);
			throw error;
		}
	}

	async getCategoryByHsnCode(hsnCode: string): Promise<SaleItemCategory | null> {
		try {
			const response = await this.apiClient.get(`saleItemcategories?hsnSacCode=${hsnCode}`);
			if (response.status >= 200 && response.status < 300) {
				const categories = response.data.categories;
				if (categories.length > 0) {
					const category = categories[0];
					return category;
				}
				return null;
			}
		} catch (error) {
			logger.error('Error fetching category by HSN/SAC code:', error);
			throw error;
		}
		return null;
	}
}

export default ItemsUtils;