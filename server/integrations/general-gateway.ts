
import { BaseGateway, type GatewayResponse, type GatewayRequest } from "./base-gateway.js";

export class GeneralGateway extends BaseGateway {
    protected readonly platform: string;

    constructor(platform: string = 'generic') {
        super();
        this.platform = platform;
    }

    async execute(req: Omit<GatewayRequest, 'platform'>): Promise<GatewayResponse> {
        return this.request(req);
    }
}

export const generalGateway = new GeneralGateway();

