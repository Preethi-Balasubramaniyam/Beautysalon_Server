import { Endpoint } from "./commTypes";

export interface Org {
  id: string;
  name: string;
  configuration: OrgConfiguration;
}

export interface OrgConfiguration {
   countryCode?: string;
   zoho?: ZohoConfiguration;
   whatsapp?: WhatsappConfiguration;
   exotel?: ExotelConfiguration;
   socket?: SocketConfiguration;
   instagram?: InstagramConfiguration
}

export interface SocketConfiguration {
  disabled: boolean;
  endpoints: string[];
}

export interface ExotelConfiguration {
  sid: string;
  token: string;
  apiKey: string;
  apiURL: string;
  phoneconfig: ExotelPhoneConfig[];
  statusUrl: string;
}

export interface ExotelPhoneConfig {
  phoneId: string;
  phoneNumber: string;
}

export interface ZohoConfiguration {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken: string;
  orgId: string;
  apiUrl: string;
  tokenUrl: string;
}

export interface WhatsappConfiguration {
  templates?: Template[],
  chatEndpoints?: Endpoint[],
  phoneconfig?: WhatsappPhoneConfig[]
}

export interface Template {
  name: string;
  category: string;
  status: string;
  language: string;
}

export interface WhatsappPhoneConfig {
  authToken: string,
  phoneId: string,
  phoneNumber: string,
  accountId: string
}

export interface InstagramConfiguration {
  authToken?: string;
  businessAccountId?: string;
}