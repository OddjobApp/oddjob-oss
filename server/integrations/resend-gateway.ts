
import { BaseGateway } from "./base-gateway.js";

export interface SendEmailOptions {
    from: string;
    to: string[];
    subject: string;
    html?: string;
    text?: string;
    cc?: string[];
    bcc?: string[];
    reply_to?: string;
}

export class ResendGateway extends BaseGateway {
    protected readonly platform = 'resend';
    private apiKey: string;
    private orgId: number | null;

    constructor(apiKey: string, orgId: number | null = null) {
        super();
        this.apiKey = apiKey;
        this.orgId = orgId;
    }

    async sendEmail(options: SendEmailOptions): Promise<any> {
        return this.execute({
            action: 'send_email',
            method: 'POST',
            url: 'https://api.resend.com/emails',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
            },
            body: {
                from: options.from,
                to: options.to,
                subject: options.subject,
                html: options.html,
                text: options.text,
                cc: options.cc,
                bcc: options.bcc,
                reply_to: options.reply_to
            },
            organizationId: this.orgId
        });
    }

    async execute(req: any): Promise<any> {
        const response = await this.request(req);
        if (response.status < 200 || response.status >= 300) {
            throw new Error(`Resend Error: ${JSON.stringify(response.body)}`);
        }
        return response.body;
    }
}

export const resendGateway = new ResendGateway(process.env.RESEND_API_KEY || '');

