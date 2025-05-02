import axios from 'axios';
import { Logger } from 'winston';
import { ExotelConfiguration } from '../types/orgTypes';
import CallRecord from '../models/callRecord';
import { CallType, Endpoint, Channel } from '../types/commTypes';
import { setTimeout } from 'timers/promises';
import EndpointModel from '../models/endpoint';
import logger from '../common/logger';
export interface ExotelService {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    initiateCall(orgConfig: ExotelConfiguration, from: string, to: string, callerId: string): Promise<any>;
    pollCallStatus(orgConfig: ExotelConfiguration, callSid: string, newCall: CallRecord, logger: Logger): Promise<void>;
    getFromEndpoint(orgId: string, orgConfig: ExotelConfiguration): Promise<Endpoint>;
    generateOtp(orgConfig: ExotelConfiguration, phone: string): Promise<string>;
}

export class ExotelServiceImpl implements ExotelService {
    async getFromEndpoint(orgId: string, orgConfig: ExotelConfiguration): Promise<Endpoint> {
        const endpoint = await EndpointModel.findOrCreateByExternalId(orgId, orgConfig.phoneconfig[0].phoneNumber, Channel.call, orgConfig.phoneconfig[0].phoneNumber);
        if (!endpoint) {
            throw new Error('From endpoint not found');
        }
        return endpoint;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async initiateCall(orgConfig: ExotelConfiguration, from: string, to: string, callerId: string): Promise<any> {
        const response = await axios.post(`${orgConfig.apiURL}/v1/Accounts/${orgConfig.sid}/Calls/connect.json`, 
            `From=${from}&To=${to}&CallerId=${callerId}&Record=true&TimeLimit=3600`, {
            auth: {
                username: orgConfig.apiKey,
                password: orgConfig.token
            }
        });

        if (response.status !== 200) {
            throw new Error('Failed to initiate call via Exotel');
        }

        return response.data.Call;
    }

    async pollCallStatus(orgConfig: ExotelConfiguration, callSid: string, newCall: CallRecord, logger: Logger): Promise<void> {
        if (!callSid || !newCall) {
            logger.error('Invalid callSid or call record');
            return;
        }
        let callStatus = 'active';
        const startTime = Date.now();
        let errorCount = 0;
        while ((Date.now() - startTime) < 3600000 && errorCount < 10) { // 1 hour = 3600000 ms
            await setTimeout(10000); // Wait for 10 seconds
            try {
                const statusResponse = await axios.get(`${orgConfig.apiURL}/v1/Accounts/${orgConfig.sid}/Calls/${callSid}.json`, {
                    auth: {
                        username: orgConfig.apiKey,
                        password: orgConfig.token
                    },
                    headers: {
                        'Content-Type': 'application/json'
                    }
                });
                logger.info('Fetched call status from Exotel: %o', statusResponse.data);
                if (statusResponse.status !== 200) {
                    logger.error('Failed to fetch call status from Exotel');
                    errorCount++;
                    continue;
                }
                callStatus = statusResponse.data.Call.Status;

                if (callStatus === 'completed' || callStatus === 'failed' || callStatus === 'busy' || callStatus === 'no-answer') {
                    logger.info(`${callSid}: Call Terminated with status: ${callStatus}`);
                    let recordStatus = CallType.error;
                    const durationInSeconds = statusResponse.data.Call.Duration;
                    const recordingUrl = statusResponse.data.Call.PreSignedRecordingUrl;
                    if (callStatus === 'completed') {
                        recordStatus = CallType.answered;
                    } else if (callStatus === 'busy' || callStatus === 'no-answer') {
                        recordStatus = CallType.noAnswer;
                    }
                    logger.info('Updating call record status: %s, %s, %s', recordStatus, durationInSeconds, recordingUrl);
                    const details = newCall.details;
                    const updated = await newCall.update({
                        durationInSeconds,
                        recordingUrl,
                        type: recordStatus,
                        details: {
                            ...details,
                            exotelLatestStatus: statusResponse.data.Call,
                        }
                    });
                    logger.info('Call record updated: %o', CallRecord.mapDBModel2Interface(updated));
                    break;
                }
            } catch (error) {
                logger.error('Error fetching call status: %o', error);
                errorCount++;
            }
        }
    }

    async generateOtp(orgConfig: ExotelConfiguration, phoneNumber: string): Promise<string> {
        const FROM = process.env.EXOTEL_SENDER_ID || '100509'; // Configurable Sender ID
        const OTP_MESSAGE_TEMPLATE = process.env.OTP_MESSAGE_TEMPLATE || 'Dear Customer, [#var#] is your one time password (OTP). Please enter the OTP to proceed. Thank you, Team YTS';
        const TEMPLATE_ID = process.env.DLT_TEMPLATE_ID || '1007925551982662564'; // Replace with your registered template ID
        const otp = Math.floor(100000 + Math.random() * 900000).toString(); // Generate OTP
        const message = OTP_MESSAGE_TEMPLATE.replace('[#var#]', otp); // Replace placeholder with OTP
        
        const body = new URLSearchParams({
            From: FROM,
            To: `91${phoneNumber}`,
            Body: message,
            template_id: TEMPLATE_ID, // Include the registered template ID
        });
        const url = `https://api.exotel.com/v1/Accounts/${orgConfig.sid}/Sms/send.json`;
        const authHeader = Buffer.from(`${orgConfig.apiKey}:${orgConfig.token}`).toString('base64');
        const headers = {
            Authorization: `Basic ${authHeader}`,
            'Content-Type': 'application/x-www-form-urlencoded',
        };

        try {
            const response = await axios.post(url, body, { headers, timeout: 5000 }); 
            if (response.status !== 200 || !response.data || !response.data.SMSMessage) {
                logger.error('Unexpected response structure from Exotel API', {
                    status: response.status,
                    rawResponse: response.data,
                    phoneNumber,
                });
                throw new Error('Unexpected response structure from Exotel API');
            }
            logger.info('OTP sent successfully', { phoneNumber, otp });
 

            return otp; 
        } catch (error) {
            logger.error('Error during OTP generation', {
                message: error instanceof Error ? error.message : 'Unknown error',
                phoneNumber,
                request: { url, body: body.toString(), headers },
                response: axios.isAxiosError(error) && error.response ? {
                    status: error.response.status,
                    data: error.response.data,
                } : 'No response received',
                stack: error instanceof Error ? error.stack : 'No stack trace available',
            });
            throw new Error('Failed to send OTP via Exotel');
        }
    }
}
