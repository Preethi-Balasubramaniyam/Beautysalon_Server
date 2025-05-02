import { AuthClient } from '../client/utils/authClient';
import CustomerUtils from '../client/utils/customerUtils';
import logger from '../common/logger';
import { ZohoBooksClient } from '../zohoServices/zohoBooksClient';
import { CustomerInput } from '../types/customerTypes';
import readline from 'readline';
import { transports } from 'winston';

const apiClient = new AuthClient('prod');
const customerClient = new CustomerUtils(apiClient);


const getBooksCustomer = (contact: any): CustomerInput | undefined => {
	logger.info('Mapping Zoho contact to Books customer: %o', contact);

	let mobile = '';
	let email = '';
	if (contact.contact_persons.length !=0) {
		mobile = contact.contact_persons[0].mobile;
		email = contact.contact_persons[0].email;
	} 
	if (!mobile || mobile == '') {
		const nameMatch = contact.contact_name.match(/\d+/);
		mobile = nameMatch ? nameMatch[0] : '';
	}
	if (!mobile || mobile == '') {
		logger.warn('No mobile number found for contact: %o', contact);
		return undefined;
	}

	const customer: CustomerInput = {
		name: contact.contact_name,
		email: email,
		mobile: mobile,
		city: contact.billing_address.city,
		postalCode: contact.billing_address.zip,
		address: contact.billing_address.address,
		booksRefId: contact.contact_id,
		gender: 'u'
	};
	return customer;
}

const fetchAllZohoCustomers = async (page: Number): Promise<{customers:CustomerInput[], hasMorePages:boolean}> => {
	logger.info('Fetching Zoho customers from page: %d', page);
	try {
		const zohoBooksClient = await ZohoBooksClient.getInstance(logger, "yazz");
		const response: any = await zohoBooksClient.getRecords('contacts', { detailedlist: true, page });
		const filteredContacts = response.contacts.filter((contact: any) => contact.status == 'active' && contact.contact_type == 'customer');
		return {
			customers: filteredContacts.map((contact: any) => getBooksCustomer(contact)),
			hasMorePages: response.page_context.has_more_page
		};
	} catch (error) {
		logger.error('Error fetching all Zoho customers: %o', error);
		throw new Error('Error fetching all Zoho customers: ' + error);
	}
}

const removePhoneNumberFromName = (name: string): string => {
	return name.replace(/(\+?\d+)/g, '').trim();
}

const fetchAndSyncZohoCustomers = async () => {
	logger.info('Starting to fetch and sync Zoho customers');
	try {
		let page = 10;
		let loopMore = true;

		while (loopMore) {
			const {customers, hasMorePages} = await fetchAllZohoCustomers(page);
			for (const customer of customers) {
				if (!customer) {
					logger.warn('Skipping undefined customer');
					continue;
				}
				if (!customer.booksRefId) {
					throw Error('Customer does not have booksRefId:');
				}
				const existingCustomer = await customerClient.getCustomerByBooksRefId(customer.booksRefId);
				if (!existingCustomer) {
					try {
						customer.name = removePhoneNumberFromName(customer.name);
						if (customer.email == '') {
							delete customer.email;
						}
						if (customer.address == '') {
							delete customer.address;
						}
						if (customer.city == '') {
							delete customer.city;
						}
						if (customer.postalCode == '') {
							customer.postalCode = '000000';
						}
						await customerClient.addCustomers([customer]);
					} catch (error) {
						logger.error(`Failed to add customer with bookRefId ${customer.booksRefId}: %o`, error);
						continue;
					}
					logger.info(`Added customer with bookRefId ${customer.booksRefId}`);
				} else {
					logger.info(`Customer with bookRefId ${customer.booksRefId} already exists`);
				}
			}
			logger.info(`Processed Zoho customers from page ${page}`);
			page++;
			loopMore = hasMorePages;
		}
	} catch (error) {
		logger.error('Error Syncing Zoho customers: %o', error);
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
	logger.add(new transports.Console());
	console.log('Logger configured to output to console');
	logger.info('Starting main function');
	const username = await askQuestion('Enter username: ');
	const password = await askQuestion('Enter password: ');
	rl.close();
	logger.info('Logging in with provided credentials');
	await apiClient.performLogin({username, password});
	logger.info('Login successful');
	await fetchAndSyncZohoCustomers();
	logger.info('Finished syncing Zoho customers');
};

main();
