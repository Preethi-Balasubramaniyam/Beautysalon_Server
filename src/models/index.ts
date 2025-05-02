import Org from './org';
import Ledger from './ledger';
import ServiceProvider from './serviceProvider';
import Branch from './branch';
import User from './user';
import Customer from './customer';
import SaleItemCategory from './saleItemCategory';
import SaleItem from './saleItem';
import Event from './event';
import Message from './message';
import Invoice from './invoice';
import CustomerPayment from './customerPayment';
import InvoiceSaleItem from './invoiceSaleItem';
import OAuthClient from './oauthClient';
import OAuthToken from './oauthToken';
import OAuthAuthorizationCode from './oauthAuthorizationCode';
import Queue from './queue';
import CallRecord from './callRecord';

// ...existing code...

const models = [
    // ...existing models...
    Org,
    Ledger,
    Branch,
    ServiceProvider,
    User,
    OAuthClient,
    OAuthToken,
    OAuthAuthorizationCode,
    Customer,
    SaleItemCategory,
    SaleItem,
    Event,
    Message,
    Invoice,
    InvoiceSaleItem,
    CustomerPayment,
    Queue,
    CallRecord,
];

// ...existing code...

export default models;