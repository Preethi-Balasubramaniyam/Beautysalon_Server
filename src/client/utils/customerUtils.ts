import { CustomerInput } from '../../types/customerTypes';
import { AuthClient } from './authClient'; // Replace with the actual package or path where AuthClient is defined
import logger  from '../../common/logger'; // Import the logger

class CustomerUtils {
	private apiClient: AuthClient;

	constructor(apiClient: AuthClient) {
		this.apiClient = apiClient;
	}
	async addCustomers (customers: CustomerInput[]) {
		for (const customer of customers) {
			try {
				const response = await this.apiClient.post('customers', customer);
				if (response.status >= 200 && response.status < 300) {
					logger.info(`Added customer :[${customer.name}, ${customer.mobile}, ${customer.booksRefId}]`);
				} 
			} catch (error) {
				if ((error as any).response?.status === 409) {
					logger.warn(`Duplicate customer: [${customer.name}, ${customer.mobile}, ${customer.booksRefId}]`);
					continue;
				}
				logger.error(`Failed to add customer: [${customer.name}, ${customer.mobile}, ${customer.booksRefId}]:%o Message: ${(error as any).response?.statusText}`, (error as any).response.data.errors);
				throw error;
			}
		}
	};

	async getCustomers() {
		try {
			const response = await this.apiClient.get('customers');
			if (response.status >= 200 && response.status < 300) {
				let customerList = (response.data as { customers: { id: string }[] }).customers;
				logger.info(`Customers: ${customerList.length}, Total: ${response.data.totalItems}`);
				return customerList;
			} 
		} catch (error) {
			logger.error('Error fetching customers: %o', error);
			throw error;
		}
	}

	async updateCustomer(customerId: string, updatedData: any) {
		try {
			const response = await this.apiClient.put(`customers/${customerId}`, updatedData);
			if (response.status >= 200 && response.status < 300) {
				logger.info('Updated customer:');
			} 
		} catch (error) {
			logger.error('Error updating customer: %o', error);
			throw error;
		}
	}

	async deleteCustomer(customerId: string) {
		try {
			const response = await this.apiClient.delete(`customers/${customerId}`);
			if (response.status >= 200 && response.status < 300) {
				logger.info('Deleted customer:');
			} 
		} catch (error) {
			logger.error('Error deleting customer:%o', error);
			throw error;
		}
	}

	async getCustomerByBooksRefId(bookRefId: string) {
		try {
			const response = await this.apiClient.get(`customers?booksRefId=${bookRefId}`);
			if (response.status >= 200 && response.status < 300) {
				const customers = response.data.customers;
				if (customers.length > 0) {
					return customers[0];
				}
				return null;
			} 
		} catch (error) {
			logger.error('Error fetching customer by bookRefId: %o', error);
			throw error;
		}
		return null;
	}
}

export default CustomerUtils;