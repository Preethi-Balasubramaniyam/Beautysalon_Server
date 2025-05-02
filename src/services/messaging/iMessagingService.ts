import { Endpoint, IMessage } from '../../types/commTypes';

export interface IMessagingService {
    id: string;
    initialize?(): Promise<void>;
    validateMessage(message: IMessage): Promise<boolean>;
    sendMessage(message: IMessage, endpoint?: Endpoint): Promise<IMessage>;
    listOrgEndpoints(): Endpoint[];
    updateStatus(message: IMessage, endpoint?: Endpoint): Promise<{ success: boolean; errorMessage?: string }>;
}
